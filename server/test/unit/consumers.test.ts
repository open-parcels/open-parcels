import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { builtinConsumers } from "../../src/consumers/builtin/index.js";
import { consumerAllowList, parseConsumerManifest } from "../../src/consumers/manifest.js";
import {
  buildMessage,
  testMessage,
  toNotification,
  type Render,
} from "../../src/consumers/notify.js";
import { DEFAULT_RULES, dueAt, wants, type NotificationRules } from "../../src/consumers/rules.js";
import { sandboxedConsumer } from "../../src/consumers/sandboxed.js";
import { consumerHttp } from "../../src/consumers/transport.js";
import type { OutboxEvent } from "../../src/events/types.js";
import { hasProviderText } from "../../src/i18n/translate.js";
import { parseRepoManifest } from "../../src/provider/repo-manifest.js";
import { Sandbox } from "../../src/sandbox/host.js";
import { startHttpFake, type FakeHttp } from "../fakes/consumer-servers.js";
import { FakeClock } from "../helpers.js";

const TZ = "Europe/Berlin";
const PARCEL = "6f1c1d8e-0000-4000-8000-000000000001";
const CONNECTION = "6f1c1d8e-0000-4000-8000-0000000000c1";

/** A made-up parcel payload as the reconciler writes it. */
function parcelEvent(type: OutboxEvent["type"], status: string, seq = 1): OutboxEvent {
  return {
    seq,
    type,
    parcelId: PARCEL,
    createdAt: "2026-11-18T12:00:00.000Z",
    payload: {
      parcel: {
        id: PARCEL,
        display_name: "Desk lamp",
        status,
        direction: "receiving",
        url: "https://tracking.example/ABC123",
        tracking_number: "ABC123",
        carrier: "dhl",
        items: [{ title: "Desk lamp" }],
        order: { shop: "Example Shop" },
        pickup_point: null,
        expected_from: null,
        expected_to: null,
        expected_days: { from: "2026-11-20", to: "2026-11-20" },
        connections: [{ connection_id: CONNECTION }],
        live: { latitude: 1, longitude: 2 },
      },
    },
  };
}

/** Every `title` and `description` in a JSON Schema. */
function textsOf(schema: unknown): string[] {
  if (typeof schema !== "object" || schema === null) return [];
  return Object.entries(schema).flatMap(([key, value]) =>
    (key === "title" || key === "description") && typeof value === "string"
      ? [value]
      : textsOf(value),
  );
}

const render: Render = {
  language: "en",
  timeZone: TZ,
  publicUrl: new URL("https://parcels.example/"),
  fields: ["tracking_number"],
};

describe("notifications from live events", () => {
  it("makes one notification per state change, with a key that catches repeats", () => {
    const out = toNotification(parcelEvent("parcel.status_changed", "out_for_delivery"));
    expect(out).toMatchObject({
      key: `parcel:${PARCEL}:status:out_for_delivery`,
      event: "out_for_delivery",
      direction: "receiving",
      connections: [CONNECTION],
    });
    // A second connection reporting the same state gives the same key.
    expect(toNotification(parcelEvent("parcel.status_changed", "out_for_delivery", 2))?.key).toBe(
      out?.key,
    );
    expect(toNotification(parcelEvent("parcel.delivered", "delivered"))?.event).toBe("delivered");
    expect(toNotification(parcelEvent("parcel.registered", "registered"))?.event).toBe(
      "registered",
    );
    expect(toNotification(parcelEvent("parcel.status_changed", "unknown"))).toBeUndefined();
    expect(toNotification(parcelEvent("parcel.live_updated", "in_transit"))).toBeUndefined();
  });

  it("notifies sign-in problems, failed backups and refunds", () => {
    const base = { seq: 1, parcelId: null, createdAt: "2026-11-18T12:00:00.000Z" };
    expect(
      toNotification({
        ...base,
        type: "connection.state_changed",
        payload: { connection: { id: CONNECTION, label: "DHL" }, new_state: "needs_sign_in" },
      }),
    ).toMatchObject({
      event: "sign_in_needed",
      key: `connection:${CONNECTION}:sign_in:2026-11-18`,
    });
    expect(
      toNotification({ ...base, type: "backup.finished", payload: { ok: false, at: "x" } }),
    ).toMatchObject({ event: "backup_failed" });
    expect(
      toNotification({ ...base, type: "backup.finished", payload: { ok: true, at: "x" } }),
    ).toBeUndefined();
    const refund = toNotification({
      ...base,
      type: "return.updated",
      payload: {
        return: {
          id: "r1",
          shop: "Example Shop",
          status: "refunded",
          parcel_id: null,
          refund: { amount: 12.5, currency: "EUR" },
        },
      },
    });
    expect(refund).toMatchObject({ event: "refunded", key: "return:r1:refunded" });
  });

  it("writes texts in the rule's language with only the fields the consumer asked for", () => {
    const candidate = toNotification(parcelEvent("parcel.status_changed", "out_for_delivery"));
    if (candidate === undefined) throw new Error("no notification");
    const stored = {
      event: candidate.event,
      data: candidate.data,
      createdAt: "2026-11-18T12:00:00Z",
    };
    const english = buildMessage([stored], render);
    expect(english).toMatchObject({
      type: "notification",
      title: "Desk lamp is out for delivery",
      url: `https://parcels.example/parcels/${PARCEL}`,
    });
    expect(english.items[0]?.parcel).toEqual({
      id: PARCEL,
      status: "out_for_delivery",
      tracking_number: "ABC123",
    });
    expect(JSON.stringify(english)).not.toContain("latitude");
    const german = buildMessage([stored, stored], { ...render, language: "de" });
    expect(german).toMatchObject({ type: "digest", title: "2 Paket-Neuigkeiten" });
    expect(german.items[0]?.title).toBe("Desk lamp ist in der Zustellung");
  });
});

describe("notification rules", () => {
  const rules = (patch: Partial<NotificationRules>): NotificationRules => ({
    ...DEFAULT_RULES,
    ...patch,
  });
  // 12:20 UTC is 13:20 in Berlin (winter time).
  const at = new Date("2026-11-18T12:20:30.000Z");

  it("filters by event, direction and connection", () => {
    const subject = {
      event: "delivered",
      direction: "sending",
      connections: [CONNECTION],
    } as const;
    expect(wants(DEFAULT_RULES, subject)).toBe(true);
    expect(wants(rules({ directions: ["receiving"] }), subject)).toBe(false);
    expect(wants(rules({ events: ["registered"] }), subject)).toBe(false);
    expect(wants(rules({ connections: ["6f1c1d8e-0000-4000-8000-0000000000c2"] }), subject)).toBe(
      false,
    );
    expect(wants(rules({ connections: [CONNECTION] }), subject)).toBe(true);
  });

  it("holds digests until the hour or 08:00 and waits out quiet hours", () => {
    expect(dueAt(DEFAULT_RULES, at, TZ)).toEqual(at);
    expect(dueAt(rules({ digest: "hourly" }), at, TZ).toISOString()).toBe(
      "2026-11-18T13:00:00.000Z",
    );
    expect(dueAt(rules({ digest: "daily" }), at, TZ).toISOString()).toBe(
      "2026-11-19T07:00:00.000Z",
    );
    const quiet = rules({ quiet_hours: { from: "22:00", to: "07:00" } });
    expect(dueAt(quiet, at, TZ)).toEqual(at);
    expect(dueAt(quiet, new Date("2026-11-18T23:30:00.000Z"), TZ).toISOString()).toBe(
      "2026-11-19T06:00:00.000Z",
    );
    const lunch = rules({ quiet_hours: { from: "12:00", to: "14:00" } });
    expect(dueAt(lunch, at, TZ).toISOString()).toBe("2026-11-18T13:00:00.000Z");
  });
});

describe("consumer manifests", () => {
  it("loads the built-ins listed by the repo manifest, each with German form texts", () => {
    const consumers = builtinConsumers(new FakeClock());
    expect([...consumers.keys()].sort()).toEqual(["apprise", "email", "ntfy", "webhook"]);
    for (const consumer of consumers.values()) {
      const { configSchema, secretSchema } = consumer.describe();
      for (const schema of [configSchema, secretSchema]) {
        if (schema === null) continue;
        for (const text of textsOf(z.toJSONSchema(schema, { io: "input" }))) {
          expect(hasProviderText(text), text).toBe(true);
        }
      }
    }
  });

  it("refuses unknown keys and two consumers with one id", () => {
    expect(() =>
      parseRepoManifest({ schema: 1, consumers: [{ id: "x", folder: "x" }] }, "t"),
    ).toThrow();
    expect(() =>
      parseRepoManifest(
        {
          schema: 1,
          consumers: [
            { id: "ntfy", folder: "a" },
            { id: "ntfy", folder: "b" },
          ],
        },
        "t",
      ),
    ).toThrow(/two consumers share an id/);
    expect(() =>
      parseConsumerManifest(
        {
          schema: 1,
          id: "spy",
          name: "Spy",
          description: "Wants positions.",
          fields: ["courier_position"],
          permissions: { network: [], smtp: false },
        },
        "spy",
      ),
    ).toThrow(/fields/);
  });

  it("allows the hosts the config names and nothing else", async () => {
    const manifest = parseConsumerManifest(
      {
        schema: 1,
        id: "probe",
        name: "Probe",
        description: "A test consumer.",
        fields: [],
        permissions: { network: [{ config: "url", reason: "The test server." }], smtp: false },
      },
      "probe",
    );
    const hosts = consumerAllowList(manifest, { url: "http://127.0.0.1:1/x" });
    expect(hosts.allows("127.0.0.1")).toBe(true);
    expect(hosts.allows("ntfy.sh")).toBe(false);
    await expect(
      consumerHttp(hosts)({ url: "https://ntfy.sh/x", method: "POST", headers: {}, body: "" }),
    ).rejects.toThrow(/not in the consumer's allowed hosts/);
  });
});

describe("an installed consumer in the sandbox", () => {
  let fake: FakeHttp | undefined;
  const boxes: Sandbox[] = [];
  afterEach(async () => {
    for (const box of boxes.splice(0)) box.stop();
    await fake?.close();
  });

  it("reaches only its declared hosts and gets its secret with the call", async () => {
    fake = await startHttpFake();
    const box = new Sandbox({
      child: new URL("../../src/sandbox/child.ts", import.meta.url),
      guest: new URL("../fakes/consumer-guest.ts", import.meta.url),
      memoryMb: 64,
      clock: new FakeClock(),
      rebuildError: (wire) => Object.assign(new Error(wire.message), wire),
    });
    boxes.push(box);
    const manifest = parseConsumerManifest(
      {
        schema: 1,
        id: "guest",
        name: "Guest",
        description: "An installed consumer.",
        fields: [],
        permissions: { network: [{ config: "url", reason: "The test server." }], smtp: false },
      },
      "guest",
    );
    const consumer = sandboxedConsumer(
      { manifest, configSchema: z.unknown(), secretSchema: null },
      box,
    );
    const config = { url: `${fake.url}/hook` };
    const call = (extra: object) => ({
      config: { ...config, ...extra },
      secret: { token: "per-call-token" },
      http: consumerHttp(consumerAllowList(manifest, config)),
    });
    const message = testMessage(render);
    await expect(consumer.deliver(message, call({}))).resolves.toEqual({ kind: "ok" });
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]?.headers.authorization).toBe("Bearer per-call-token");
    const stray = await consumer.test(message, call({ stray: "http://192.0.2.1/elsewhere" }));
    expect(stray.kind).toBe("failed");
    expect(JSON.stringify(stray)).toMatch(/not in the consumer's allowed hosts/);
    expect(fake.requests).toHaveLength(1);
  });
});

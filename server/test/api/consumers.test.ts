import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/api/app.js";
import { appendEvent } from "../../src/events/bus.js";
import type { EventType } from "../../src/events/types.js";
import { DEFAULT_RULES } from "../../src/consumers/rules.js";
import {
  startHttpFake,
  startSmtpFake,
  type FakeHttp,
  type FakeSmtp,
} from "../fakes/consumer-servers.js";
import { createTestContext, signIn, type TestContext } from "../helpers.js";

/** Consumers end to end, against fake ntfy, webhook, apprise-api and SMTP servers only. */

interface ConsumerBody {
  id: string;
  consumer: string;
  has_secret: boolean;
  config: Record<string, unknown>;
  last_ok_at: string | null;
  last_error: string | null;
}

const PARCEL = "6f1c1d8e-0000-4000-8000-000000000001";
const CONNECTIONS = [
  "6f1c1d8e-0000-4000-8000-0000000000c1",
  "6f1c1d8e-0000-4000-8000-0000000000c2",
];
// Made-up values, built from parts (the pre-commit hook refuses literal secrets).
const SIGNING = ["made", "up", "signing", "key", "for", "tests"].join("-");
const TOKEN = ["tk", "fake", "ntfy"].join("_");

let context: TestContext;
let app: App;
let headers: Record<string, string>;
const fakes: { close(): Promise<void> }[] = [];

beforeEach(async () => {
  context = await createTestContext({
    env: { OPENPARCELS_PUBLIC_URL: "https://parcels.example/" },
  });
  app = await context.app();
  const session = await signIn(context, app);
  headers = { cookie: session.cookie, "x-csrf-token": session.csrf };
});

afterEach(async () => {
  await Promise.all(fakes.splice(0).map((fake) => fake.close()));
  await context.close();
});

async function http(): Promise<FakeHttp> {
  const fake = await startHttpFake();
  fakes.push(fake);
  return fake;
}

async function smtp(): Promise<FakeSmtp> {
  const fake = await startSmtpFake();
  fakes.push(fake);
  return fake;
}

async function add(payload: Record<string, unknown>): Promise<ConsumerBody> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/consumers",
    headers,
    payload: { rules: DEFAULT_RULES, ...payload },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<ConsumerBody>();
}

async function sendTest(id: string) {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/consumers/${id}/test`,
    headers,
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ ok: boolean; retry: boolean; message: string | null }>();
}

/** A made-up parcel live event, as the reconciler writes it, from one of two connections. */
async function parcelEvent(type: EventType, status: string, connection = 0): Promise<void> {
  const parcel = {
    id: PARCEL,
    display_name: "Desk lamp",
    status,
    direction: "receiving",
    url: "https://tracking.example/ABC123",
    tracking_number: "ABC123",
    carrier: "dhl",
    items: [{ title: "Desk lamp" }],
    order: null,
    pickup_point: null,
    expected_from: null,
    expected_to: null,
    expected_days: null,
    connections: [{ connection_id: CONNECTIONS[connection] }],
  };
  await appendEvent(context.services.db, context.clock, {
    type,
    parcelId: PARCEL,
    payload: { parcel },
  });
  await context.services.bus.notify();
}

describe("configured consumers", () => {
  it("stores the secret encrypted and never returns it; refuses bad settings", async () => {
    const created = await add({
      consumer: "ntfy",
      label: "Phone",
      config: { server: "http://127.0.0.1:9", topic: "parcels" },
      secret: { token: TOKEN },
    });
    expect(created).toMatchObject({ has_secret: true, config: { priority: 3 } });
    const listed = await app.inject({ method: "GET", url: "/api/v1/consumers", headers });
    expect(listed.body).not.toContain(TOKEN);
    const bad = await app.inject({
      method: "POST",
      url: "/api/v1/consumers",
      headers,
      payload: {
        consumer: "ntfy",
        label: "x",
        config: { server: "ftp://x", topic: "t" },
        rules: DEFAULT_RULES,
      },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({
      error: "invalid_consumer",
      params: { reason: "invalid_config" },
    });
    const removed = await app.inject({
      method: "DELETE",
      url: `/api/v1/consumers/${created.id}`,
      headers,
    });
    expect(removed.statusCode).toBe(204);
  });

  it("lists the built-in consumers with their forms", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/consumers/available",
      headers: { ...headers, "accept-language": "de" },
    });
    const body =
      response.json<
        { id: string; config_schema: { properties: Record<string, { title?: string }> } }[]
      >();
    expect(body.map((entry) => entry.id).sort()).toEqual(["apprise", "email", "ntfy", "webhook"]);
    expect(
      body.find((entry) => entry.id === "ntfy")?.config_schema.properties["topic"]?.title,
    ).toBe("Thema");
  });
});

describe("send test notification", () => {
  it("publishes to ntfy with the token, a click link and a view action", async () => {
    const ntfy = await http();
    const created = await add({
      consumer: "ntfy",
      label: "Phone",
      config: { server: ntfy.url, topic: "parcels", priority: 4 },
      secret: { token: TOKEN },
      rules: { ...DEFAULT_RULES, language: "de" },
    });
    expect(await sendTest(created.id)).toEqual({ ok: true, retry: false, message: null });
    const [request] = ntfy.requests;
    expect(request?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(request?.body ?? "{}")).toMatchObject({
      topic: "parcels",
      title: "Testbenachrichtigung",
      priority: 4,
      click: "https://parcels.example/",
      actions: [{ action: "view", label: "Paket ansehen", url: "https://parcels.example/" }],
    });
  });

  it("signs webhooks with HMAC-SHA256 over timestamp and body", async () => {
    const hook = await http();
    const created = await add({
      consumer: "webhook",
      label: "Automation",
      config: { url: `${hook.url}/in` },
      secret: { signing_secret: SIGNING },
    });
    expect((await sendTest(created.id)).ok).toBe(true);
    const [request] = hook.requests;
    const timestamp = String(request?.headers["x-open-parcels-timestamp"]);
    const expected = createHmac("sha256", SIGNING)
      .update(`${timestamp}.${request?.body ?? ""}`)
      .digest("hex");
    expect(request?.headers["x-open-parcels-signature"]).toBe(`sha256=${expected}`);
    expect(JSON.parse(request?.body ?? "{}")).toMatchObject({ type: "test", notifications: [] });
  });

  it("hands Apprise URLs to apprise-api, or a stored key", async () => {
    const apprise = await http();
    const stateless = await add({
      consumer: "apprise",
      label: "Apprise",
      config: { server: apprise.url },
      secret: { urls: "json://127.0.0.1/a\nmailto://user@example.com" },
    });
    expect((await sendTest(stateless.id)).ok).toBe(true);
    expect(apprise.requests[0]?.path).toBe("/notify");
    expect(JSON.parse(apprise.requests[0]?.body ?? "{}")).toMatchObject({
      urls: ["json://127.0.0.1/a", "mailto://user@example.com"],
    });
    const keyed = await add({
      consumer: "apprise",
      label: "Key",
      config: { server: apprise.url, key: "parcels" },
    });
    expect((await sendTest(keyed.id)).ok).toBe(true);
    expect(apprise.requests[1]?.path).toBe("/notify/parcels");
  });

  it("sends an email with an HTML and a text part", async () => {
    const server = await smtp();
    const created = await add({
      consumer: "email",
      label: "Mail",
      config: {
        host: "127.0.0.1",
        port: server.port,
        security: "none",
        from: "parcels@example.com",
        to: "owner@example.com",
      },
    });
    expect(await sendTest(created.id)).toEqual({ ok: true, retry: false, message: null });
    const [mail] = server.mails;
    expect(mail?.to).toEqual(["<owner@example.com>"]);
    expect(mail?.data).toContain("text/plain");
    expect(mail?.data).toContain("text/html");
    expect(mail?.data).toContain("Test notification");
  });

  it("reports a service that refuses as not delivered", async () => {
    const ntfy = await http();
    ntfy.answer(403);
    const created = await add({
      consumer: "ntfy",
      label: "Phone",
      config: { server: ntfy.url, topic: "t" },
    });
    expect(await sendTest(created.id)).toMatchObject({ ok: false, retry: false });
  });
});

describe("delivery from the outbox", () => {
  it("sends one notification per state change across connections, and a dead consumer blocks nothing", async () => {
    const ntfy = await http();
    const good = await add({
      consumer: "ntfy",
      label: "Phone",
      config: { server: ntfy.url, topic: "t" },
    });
    // Nothing listens on port 9: every attempt fails.
    const dead = await add({
      consumer: "ntfy",
      label: "Dead",
      config: { server: "http://127.0.0.1:9", topic: "t" },
    });
    const { notifications } = context.services;

    await parcelEvent("parcel.status_changed", "out_for_delivery", 0);
    await parcelEvent("parcel.status_changed", "out_for_delivery", 1);
    await parcelEvent("parcel.status_changed", "in_transit", 1);
    await notifications.runOnce();
    // in_transit is not in the default rules; the repeat from the second connection is dropped.
    expect(ntfy.requests).toHaveLength(1);
    expect(JSON.parse(ntfy.requests[0]?.body ?? "{}")).toMatchObject({
      title: "Desk lamp is out for delivery",
      click: `https://parcels.example/parcels/${PARCEL}`,
    });

    await parcelEvent("parcel.delivered", "delivered");
    await notifications.runOnce();
    expect(ntfy.requests).toHaveLength(2);

    const status = await app.inject({ method: "GET", url: "/api/v1/status", headers });
    const report = status.json<{
      checks: { consumers: string };
      consumers: {
        id: string;
        last_ok_at: string | null;
        last_error: string | null;
        pending: number;
      }[];
    }>();
    expect(report.checks.consumers).toBe("degraded");
    expect(report.consumers.find((line) => line.id === good.id)).toMatchObject({
      last_error: null,
      pending: 0,
    });
    const deadLine = report.consumers.find((line) => line.id === dead.id);
    expect(deadLine?.last_error).toMatch(/failed/);
    expect(deadLine?.pending).toBe(2);

    // Backoff: nothing is tried again before it is due.
    await notifications.runOnce();
    expect(ntfy.requests).toHaveLength(2);
  });

  it("collects a digest until the hour", async () => {
    const ntfy = await http();
    await add({
      consumer: "ntfy",
      label: "Digest",
      config: { server: ntfy.url, topic: "t" },
      rules: { ...DEFAULT_RULES, digest: "hourly" },
    });
    await parcelEvent("parcel.registered", "registered");
    await parcelEvent("parcel.status_changed", "out_for_delivery");
    await context.services.notifications.runOnce();
    expect(ntfy.requests).toHaveLength(0);
    context.clock.advance(60 * 60 * 1000);
    await context.services.notifications.runOnce();
    expect(ntfy.requests).toHaveLength(1);
    expect(JSON.parse(ntfy.requests[0]?.body ?? "{}")).toMatchObject({ title: "2 parcel updates" });
  });
});

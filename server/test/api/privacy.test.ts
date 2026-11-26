import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { App } from "../../src/api/app.js";
import { accountMasker } from "../../src/api/privacy.js";
import { DEFAULT_RULES } from "../../src/consumers/rules.js";
import { FakeWorld, fakePost } from "../fakes/carriers.js";
import { createTestContext, READER_PASSWORD, signIn, type TestContext } from "../helpers.js";

/** Made-up account names; none of them may reach a caller without a login. */
const PERSON = "Jane Example";
const ADDRESS = "jane@example.invalid";
const INBOX_LABEL = `Inbox ${ADDRESS} (imap.example.invalid)`;
const ACCOUNT_LABEL = `Fake Post · ${PERSON}`;
const TOPIC = "made-up-topic-1";

let context: TestContext | undefined;
afterEach(async () => {
  await context?.close();
  context = undefined;
});

interface Setup {
  readonly app: App;
  readonly admin: Record<string, string>;
}

async function start(env: Record<string, string> = {}): Promise<Setup> {
  const ctx = await createTestContext({ providers: [fakePost(new FakeWorld())], env });
  context = ctx;
  const app = await ctx.app();
  const session = await signIn(ctx, app);
  const admin = { cookie: session.cookie, "x-csrf-token": session.csrf };
  const credentials = { username: ADDRESS, password: ["made", "up"].join("-") };
  const created = await app.inject({
    method: "POST",
    url: "/api/v1/connections",
    headers: admin,
    payload: { provider: "fakepost", kind: "account", label: ACCOUNT_LABEL, secret: credentials },
  });
  expect(created.statusCode).toBe(201);
  const now = ctx.clock.now().toISOString();
  await ctx.services.db
    .insertInto("connections")
    .values({
      id: "00000000-0000-4000-8000-00000000000a",
      provider: "imap",
      kind: "mail",
      label: INBOX_LABEL,
      config: JSON.stringify({ host: "imap.example.invalid" }),
      secret_blob: null,
      session_blob: null,
      state: "ok",
      state_reason: null,
      carrier_message: null,
      backoff_until: null,
      next_run_at: null,
      last_run_at: null,
      last_ok_at: null,
      created_at: now,
      updated_at: now,
    })
    .execute();
  const consumer = await app.inject({
    method: "POST",
    url: "/api/v1/consumers",
    headers: admin,
    payload: {
      consumer: "ntfy",
      label: `ntfy for ${PERSON}`,
      config: { server: "https://ntfy.example.invalid", topic: TOPIC },
      rules: DEFAULT_RULES,
    },
  });
  expect(consumer.statusCode).toBe(201);
  return { app, admin };
}

const READ_URLS = ["/api/v1/connections", "/api/v1/status", "/api/v1/consumers", "/api/v1/sync"];

function expectNoAccounts(body: string): void {
  for (const secret of [PERSON, ADDRESS, TOPIC]) expect(body).not.toContain(secret);
}

describe("accounts in the read-only view (owner decision 2026-11-26)", () => {
  it("shows a caller without a login only the provider's and consumer's names", async () => {
    const { app } = await start();
    for (const url of READ_URLS) {
      const response = await app.inject({ url });
      expect(response.statusCode, url).toBe(200);
      expectNoAccounts(response.body);
    }
    const connections = (await app.inject({ url: "/api/v1/connections" })).json<
      { provider: string; label: string; config: unknown }[]
    >();
    expect(connections.map(({ label, config }) => ({ label, config }))).toEqual(
      expect.arrayContaining([
        { label: "Fake Post", config: null },
        { label: "Inbox", config: null },
      ]),
    );
    const german = (
      await app.inject({ url: "/api/v1/connections", headers: { "accept-language": "de" } })
    ).json<{ provider: string; label: string }[]>();
    expect(german.find((connection) => connection.provider === "imap")?.label).toBe("Postfach");
    const consumers = (await app.inject({ url: "/api/v1/consumers" })).json<
      { label: string; config: unknown }[]
    >();
    expect(consumers).toEqual([expect.objectContaining({ label: "ntfy", config: null })]);
  });

  it("shows them to the admin, a logged-in reader and an API token", async () => {
    const { app, admin } = await start({ OPENPARCELS_PASSWORD: READER_PASSWORD });
    const reader = await app.inject({
      method: "POST",
      url: "/api/v1/session",
      payload: { password: READER_PASSWORD },
    });
    const readerCookie = reader.cookies.find((entry) => entry.name === "op_session");
    const token = (
      await app.inject({
        method: "POST",
        url: "/api/v1/tokens",
        headers: admin,
        payload: { name: "ha", scopes: ["read", "write"] },
      })
    ).json<{ token: string }>().token;
    const callers: Record<string, string>[] = [
      admin,
      { cookie: `op_session=${readerCookie?.value ?? ""}` },
      { authorization: `Bearer ${token}` },
    ];
    for (const headers of callers) {
      const body = (await app.inject({ url: "/api/v1/connections", headers })).body;
      expect(body).toContain(ACCOUNT_LABEL);
      expect(body).toContain(INBOX_LABEL);
      expect((await app.inject({ url: "/api/v1/consumers", headers })).body).toContain(TOPIC);
    }
    expect((await app.inject({ url: "/api/v1/connections" })).statusCode).toBe(401);
  });

  it("masks connections in the live events a caller without a login receives", async () => {
    const { app, admin } = await start();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${String((app.server.address() as AddressInfo).port)}`;
    const stream = await fetch(`${base}/api/v1/events`);
    expect(stream.status).toBe(200);
    const reader = stream.body?.getReader();
    if (reader === undefined) throw new Error("The stream has no body.");
    const decoder = new TextDecoder();
    let text = "";
    const added = await app.inject({
      method: "POST",
      url: "/api/v1/connections",
      headers: admin,
      payload: { provider: "fakepost", kind: "tracking", label: `Tracking for ${PERSON}` },
    });
    expect(added.statusCode).toBe(201);
    // Bounded: at most 20 chunks, the stream sends the event at once.
    for (let chunk = 0; chunk < 20 && !text.includes("event: connection.added"); chunk += 1) {
      const result = await reader.read();
      if (result.done) break;
      text += decoder.decode(result.value as Uint8Array, { stream: true });
    }
    await reader.cancel();
    expect(text).toContain('"label":"Fake Post"');
    expectNoAccounts(text);
  });
});

describe("accountMasker", () => {
  const mask = accountMasker(
    { provider: (id) => (id === "amazon" ? "Amazon" : null), consumer: () => null },
    "en",
  );

  it("keeps a parcel's own label and masks only its connections", () => {
    const parcel = {
      label: "Birthday present",
      connections: [
        { connection_id: "c1", provider: "amazon", label: `amazon.de · ${PERSON}`, kind: "shop" },
        { connection_id: "c2", provider: "gone", label: PERSON, kind: "tracking" },
      ],
    };
    expect(mask({ parcel })).toEqual({
      parcel: {
        label: "Birthday present",
        connections: [
          { connection_id: "c1", provider: "amazon", label: "Amazon", kind: "shop" },
          { connection_id: "c2", provider: "gone", label: "gone", kind: "tracking" },
        ],
      },
    });
  });
});

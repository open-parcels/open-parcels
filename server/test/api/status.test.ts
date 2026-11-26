import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { App } from "../../src/api/app.js";
import { demoCarrier } from "../../src/carriers/demo/index.js";
import { registerBuiltin } from "../manifests.js";
import { READER_PASSWORD, createTestContext, type TestContext } from "../helpers.js";

let context: TestContext;
let app: App;

afterEach(async () => {
  context.services.scheduler.stop();
  await context.close();
});

async function start(env: Record<string, string> = {}): Promise<void> {
  context = await createTestContext({ providers: [registerBuiltin(demoCarrier)], env });
  app = await context.app();
}

interface Health {
  status: string;
  checks: Record<string, string>;
}

async function health(): Promise<{ code: number; body: Health }> {
  const response = await app.inject({ url: "/api/v1/health" });
  return { code: response.statusCode, body: response.json<Health>() };
}

async function addInbox(state: "ok" | "needs_sign_in"): Promise<void> {
  const now = context.clock.now().toISOString();
  await context.services.db
    .insertInto("connections")
    .values({
      id: "inbox-1",
      provider: "imap",
      kind: "mail",
      label: "Inbox",
      config: "{}",
      secret_blob: null,
      session_blob: null,
      state,
      state_reason: state === "ok" ? null : "inbox_sign_in_rejected",
      carrier_message: null,
      backoff_until: null,
      next_run_at: null,
      last_run_at: null,
      last_ok_at: null,
      created_at: now,
      updated_at: now,
    })
    .execute();
}

describe("health and status", () => {
  it("is ok with nothing to worry about", async () => {
    await start();
    // As `main` does. Only here: a running scheduler would run the other tests' connections.
    context.services.scheduler.start();
    expect(await health()).toEqual({
      code: 200,
      body: {
        status: "ok",
        checks: {
          database: "ok",
          connections: "ok",
          inboxes: "ok",
          scheduler: "ok",
          event_stream: "ok",
          backups: "ok",
          consumers: "ok",
        },
      },
    });
  });

  it("is degraded, not down, while a connection is in error, and names it on the status page", async () => {
    await start();
    const connection = await context.services.connections.create({
      provider: "demo",
      kind: "tracking",
      label: "Demo tracking",
      config: {},
      secret: null,
    });
    await context.services.connections.setState(connection.id, "error", {
      reason: "update_failed",
      carrierMessage: "Demo answered HTTP 500.",
    });
    const { code, body } = await health();
    expect(code).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks["connections"]).toBe("degraded");
    // Readiness, which container health checks use, does not flap with a carrier.
    expect((await app.inject({ url: "/api/v1/health/ready" })).statusCode).toBe(200);

    const status = await app.inject({ url: "/api/v1/status" });
    expect(status.statusCode).toBe(200);
    expect(status.json<{ install_id: string }>().install_id).toBe(
      await context.services.settings.installId(),
    );
    expect(status.json<{ connections: unknown[] }>().connections).toEqual([
      expect.objectContaining({
        id: connection.id,
        // Read without a login: the provider's name, not the connection's own label.
        label: "Demo courier",
        state: "error",
        state_reason: "update_failed",
        carrier_message: "Demo answered HTTP 500.",
      }),
    ]);
  });

  it("reports inboxes on their own", async () => {
    await start();
    await addInbox("needs_sign_in");
    const { body } = await health();
    expect(body.checks).toMatchObject({ inboxes: "degraded", connections: "ok" });
    const status = await app.inject({ url: "/api/v1/status" });
    expect(status.json<{ inboxes: unknown[] }>().inboxes).toEqual([
      expect.objectContaining({ id: "inbox-1", state: "needs_sign_in", connected: false }),
    ]);
  });

  it("is degraded when the scheduler is not running", async () => {
    await start();
    expect((await health()).body.checks["scheduler"]).toBe("degraded");
  });

  it("is degraded while backups fail", async () => {
    await start();
    const blocker = path.join(context.dataDir, "blocker");
    writeFileSync(blocker, "");
    await context.services.configSettings.patch({ OPENPARCELS_BACKUP_DIR: blocker });
    await context.services.backups.run("scheduled");
    const { body } = await health();
    expect(body).toMatchObject({ status: "degraded", checks: { backups: "degraded" } });
    const status = await app.inject({ url: "/api/v1/status" });
    expect(status.json<{ backups: unknown }>().backups).toMatchObject({
      enabled: true,
      last_ok: false,
    });
  });

  it("shows the summary to anyone and the details to readers only", async () => {
    await start({ OPENPARCELS_PASSWORD: READER_PASSWORD });
    expect((await health()).code).toBe(200);
    expect((await app.inject({ url: "/api/v1/status" })).statusCode).toBe(401);
  });
});

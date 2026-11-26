import { sql } from "kysely";
import { z } from "zod";
import { backupErrorSchema } from "../../data/backup.js";
import { databaseErrorSchema } from "../../status/database-error.js";
import { SCHEDULER_ERRORS } from "../../engine/scheduler.js";
import type { Services } from "../../services.js";
import { CHECK_NAMES, CHECK_STATES, collectStatus, type CheckName } from "../../status/service.js";
import type { TypedApp } from "../app.js";
import { carrierMessageSchema, stateReasonSchema } from "../schemas.js";

const healthSchema = z.object({ status: z.enum(["ok", "unavailable"]) });
const checkState = z.enum(CHECK_STATES);
const checksSchema = z.object(
  Object.fromEntries(CHECK_NAMES.map((name) => [name, checkState])) as Record<
    CheckName,
    typeof checkState
  >,
);

const summarySchema = z.object({
  status: checkState.describe(
    "`ok`; `degraded`: it works, but something needs attention (a connection or inbox in error or needing sign-in, a failing backup, a stalled scheduler); `unavailable`: the database does not answer.",
  ),
  checks: checksSchema,
});

const connectionStatusSchema = z.object({
  id: z.string(),
  provider: z.string(),
  label: z.string(),
  kind: z.enum(["account", "tracking", "shop", "mail"]),
  state: z.enum(["ok", "idle", "needs_sign_in", "error", "disabled"]),
  state_reason: stateReasonSchema,
  carrier_message: carrierMessageSchema,
  consecutive_failures: z.number().int(),
  last_run_at: z.string().nullable(),
  last_ok_at: z.string().nullable(),
  next_run_at: z.string().nullable(),
  backoff_until: z
    .string()
    .nullable()
    .describe("The carrier asked for a pause (rate limit, captcha) until then."),
});

const statusSchema = summarySchema.extend({
  checked_at: z.string(),
  version: z.string(),
  commit: z
    .string()
    .nullable()
    .describe("The git commit (7 characters) the image was built from; null outside an image."),
  install_id: z
    .string()
    .describe(
      "A random id created once per install and kept for its lifetime; clients use it to recognise the same server (the Home Assistant integration's unique id).",
    ),
  started_at: z.string(),
  database: z.object({ error: databaseErrorSchema }),
  connections: z.array(connectionStatusSchema).describe("Every enabled connection but inboxes."),
  inboxes: z.array(
    connectionStatusSchema.extend({
      connected: z.boolean().describe("Connected to the mail server and watching for new email."),
      reconnect_at: z.string().nullable().describe("When the next reconnect is tried."),
    }),
  ),
  scheduler: z.object({
    running: z.boolean(),
    in_flight: z.number().int().describe("Connection runs in progress."),
    last_cycle_at: z.string().nullable(),
    last_error: z
      .enum(SCHEDULER_ERRORS)
      .nullable()
      .describe("`cycle_failed`: the last cycle failed (the server log says why)."),
    next_run_at: z.string().nullable().describe("The earliest planned connection run."),
  }),
  event_stream: z.object({
    clients: z.number().int().describe("Clients connected to the live event stream."),
    last_seq: z.number().int(),
    stored: z.number().int().describe("Live events kept for replay."),
    live_sessions: z.number().int().describe("Couriers followed live now."),
  }),
  backups: z.object({
    enabled: z.boolean(),
    last_ok: z.boolean().nullable(),
    last_at: z.string().nullable(),
    last_error: backupErrorSchema,
    next_at: z.string().nullable(),
  }),
  consumers: z
    .array(
      z.object({
        id: z.string(),
        consumer: z.string(),
        label: z.string(),
        enabled: z.boolean(),
        last_attempt_at: z.string().nullable(),
        last_ok_at: z.string().nullable(),
        last_error: z.string().nullable().describe("Why the last attempt did not deliver."),
        pending: z.number().int().describe("Notifications waiting (due later, or retrying)."),
        failed: z.number().int().describe("Notifications it gave up on."),
      }),
    )
    .describe("Each configured consumer's last delivery."),
});

/**
 * Three levels, so container health checks never flap on a carrier's bad day: `live` (the process
 * runs) and `ready` (the database answers) decide whether the container is healthy; `/health`
 * says whether anything needs attention, and `/status` shows the details.
 */
export function registerHealthRoutes(app: TypedApp, services: Services): void {
  app.get(
    "/api/v1/health/live",
    {
      schema: {
        tags: ["health"],
        summary: "The process is running.",
        security: [],
        response: { 200: healthSchema },
      },
    },
    () => ({ status: "ok" as const }),
  );

  app.get(
    "/api/v1/health/ready",
    {
      schema: {
        tags: ["health"],
        summary: "The service can answer requests: the database responds.",
        description:
          "What container health checks should use. Connections in error do not make it fail; `/api/v1/health` reports those.",
        security: [],
        response: { 200: healthSchema, 503: healthSchema },
      },
    },
    async (_request, reply) => {
      try {
        await sql`select 1`.execute(services.db);
        return { status: "ok" as const };
      } catch (error) {
        services.logger.error({ err: error }, "Readiness check failed.");
        return reply.code(503).send({ status: "unavailable" as const });
      }
    },
  );

  app.get(
    "/api/v1/health",
    {
      schema: {
        tags: ["health"],
        summary: "Overall state and one state per part, without details.",
        description:
          "200 while the service works (also when `degraded`), 503 when it is `unavailable`. Names no connection and holds no data, so monitoring can read it without signing in.",
        security: [],
        response: { 200: summarySchema, 503: summarySchema },
      },
    },
    async (_request, reply) => {
      const { status, checks } = await collectStatus(services);
      return reply.code(status === "unavailable" ? 503 : 200).send({ status, checks });
    },
  );

  app.get(
    "/api/v1/status",
    {
      schema: {
        tags: ["status"],
        summary:
          "Every connection, inbox, the scheduler, the live event stream and backups, with what needs attention.",
        response: { 200: statusSchema },
      },
    },
    () => collectStatus(services),
  );
}

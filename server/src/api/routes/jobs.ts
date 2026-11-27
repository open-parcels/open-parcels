import { z } from "zod";
import { requestLanguage, type Language } from "../../i18n/language.js";
import { localizeSchema, providerText } from "../../i18n/translate.js";
import { JobError, type ConnectionAction, type DeclaredAction } from "../../jobs/service.js";
import { jobBody, JOB_STATES } from "../../jobs/store.js";
import type { Services } from "../../services.js";
import type { TypedApp } from "../app.js";
import { requireScope } from "../auth-plugin.js";
import { ApiError, errorBodySchema, notFound } from "../errors.js";
import { connectionKindSchema } from "../../domain/parcel.js";
import { idParams } from "../schemas.js";

/** Connection actions and jobs (`docs/connection-actions-and-jobs.md` §4). */

export const actionSchema = z.object({
  id: z.string(),
  kind: z.enum(["task", "link"]).describe("A task runs as a job; a link only opens an address."),
  label: z.string(),
  description: z.string().nullable(),
  connection_kinds: z.array(connectionKindSchema),
  when_state: z
    .array(z.enum(["ok", "idle", "needs_sign_in", "error"]))
    .describe("Connection states in which the action may start."),
  weight: z.enum(["light", "heavy"]).describe("Heavy jobs run one at a time per server."),
  confirm: z.string().nullable().describe("Ask the user this before starting, when set."),
  destructive: z
    .boolean()
    .describe("Have the connection's label typed to confirm; never an HA button."),
  expose_to_ha: z.boolean().describe("Offered as an HA button when it needs no input."),
  cooldown_minutes: z.number().int().describe("Earliest re-run after a finished job."),
  input_schema: z
    .unknown()
    .nullable()
    .describe("JSON Schema of the task's input form; null for a link or a task without input."),
  input_required: z.boolean().describe("Some input field has no default: ask before starting."),
});

/** One action as the API shows it, its texts in the request's language. */
export function actionBody(
  language: Language,
  source: { actionInput(actionId: string): z.ZodType | undefined },
  action: DeclaredAction,
): z.infer<typeof actionSchema> {
  const text = (value: string | undefined): string | null =>
    value === undefined ? null : providerText(language, value);
  const input = action.kind === "task" ? source.actionInput(action.id) : undefined;
  const schema = input === undefined ? null : z.toJSONSchema(input, { io: "input" });
  const fields =
    schema !== null && typeof schema.properties === "object" ? Object.keys(schema.properties) : [];
  return {
    id: action.id,
    kind: action.kind,
    label: providerText(language, action.label),
    description: text(action.description),
    connection_kinds: [...action.connection_kinds],
    when_state: [...action.when_state],
    weight: action.kind === "task" ? action.weight : "light",
    confirm: action.kind === "task" ? text(action.confirm) : null,
    destructive: action.kind === "task" && action.destructive,
    expose_to_ha: action.kind === "task" && action.expose_to_ha,
    cooldown_minutes: action.kind === "task" ? action.cooldown_minutes : 0,
    input_schema: fields.length === 0 ? null : localizeSchema(language, schema),
    input_required: input !== undefined && !input.safeParse({}).success,
  };
}

const jobSchema = z.object({
  id: z.uuid(),
  connection_id: z.uuid(),
  provider: z.string(),
  action: z.string(),
  state: z.enum(JOB_STATES),
  reason: z
    .string()
    .nullable()
    .describe(
      "Why it is paused or failed: rate_limited, captcha, needs_sign_in, retrying, " +
        "waiting_for_carrier, resting, ceiling, invalid_config, page_changed, action_missing or " +
        "unexpected.",
    ),
  progress: z.object({
    done: z.number().nullable(),
    total: z.number().nullable().describe("Null: not known (yet)."),
    phase: z.string().nullable().describe("Where it is, in the provider's words."),
  }),
  summary: z.string().nullable(),
  created_at: z.string(),
  started_at: z.string().nullable(),
  updated_at: z.string(),
  finished_at: z.string().nullable(),
  resume_at: z.string().nullable().describe("When a paused job continues on its own."),
});

const connectionActionSchema = actionSchema.extend({
  available: z.boolean().describe("May start now: the connection's state allows it, no job runs."),
  cooldown_until: z.string().nullable(),
});

const errors = { 400: errorBodySchema, 404: errorBodySchema, 409: errorBodySchema };

/** A job service error as the API's. */
function asApiError(error: unknown): never {
  if (!(error instanceof JobError)) throw error;
  switch (error.code) {
    case "connection_not_found":
      throw notFound("connection");
    case "job_not_found":
      throw notFound("job");
    case "no_such_action":
      throw new ApiError(404, "no_such_action", error.message);
    case "invalid_input":
      throw new ApiError(400, "invalid_input", error.message);
    case "action_cooldown":
      throw new ApiError(429, "action_cooldown", error.message, {
        seconds: error.retryAfterSeconds ?? 1,
      });
    case "action_unavailable":
    case "job_running":
    case "job_state":
      throw new ApiError(409, error.code, error.message);
  }
}

export function registerJobRoutes(app: TypedApp, services: Services): void {
  const read = requireScope("read");
  const write = requireScope("write");
  const { jobs } = services;

  app.get(
    "/api/v1/connections/:id/actions",
    {
      preHandler: read,
      schema: {
        tags: ["jobs"],
        summary: "The connection's actions, with whether each may start now.",
        params: idParams,
        response: { 200: z.array(connectionActionSchema), 404: errorBodySchema },
      },
    },
    async (request) => {
      const language = requestLanguage(request.headers["accept-language"]);
      const connection = await services.connections.get(request.params.id);
      const source = connection === undefined ? undefined : jobs.sourceOf(connection.provider);
      const actions = await jobs.actionsOf(request.params.id);
      if (actions === undefined) throw notFound("connection");
      return source === undefined
        ? []
        : actions.map((entry: ConnectionAction) => ({
            ...actionBody(language, source, entry.action),
            available: entry.available,
            cooldown_until: entry.cooldownUntil,
          }));
    },
  );

  app.post(
    "/api/v1/connections/:id/actions/:action",
    {
      preHandler: write,
      schema: {
        tags: ["jobs"],
        summary: "Start an action: a task becomes a job, a link answers with its address.",
        description:
          "409 `job_running` while the connection has a job, 409 `action_unavailable` in a " +
          "state the action does not run in, 429 `action_cooldown` (with `Retry-After`) " +
          "shortly after the last finished job.",
        params: z.object({ id: z.uuid(), action: z.string().regex(/^[a-z0-9_]{1,40}$/) }),
        body: z.object({ input: z.unknown().optional() }).default({}),
        response: {
          200: z.object({ url: z.string() }),
          202: z.object({ job: jobSchema }),
          ...errors,
          429: errorBodySchema,
        },
      },
    },
    async (request, reply) => {
      const outcome = await jobs
        .startAction(request.params.id, request.params.action, request.body.input)
        .catch((error: unknown) => {
          if (error instanceof JobError && error.code === "action_cooldown") {
            void reply.header("retry-after", String(error.retryAfterSeconds ?? 1));
          }
          return asApiError(error);
        });
      if ("url" in outcome) return reply.code(200).send({ url: outcome.url });
      return reply.code(202).send({ job: jobBody(outcome.job) });
    },
  );

  app.get(
    "/api/v1/jobs",
    {
      preHandler: read,
      schema: {
        tags: ["jobs"],
        summary: "Jobs, newest first (at most 200).",
        querystring: z.object({
          connection_id: z.uuid().optional(),
          state: z.enum(JOB_STATES).optional(),
        }),
        response: { 200: z.array(jobSchema) },
      },
    },
    async (request) => {
      const { connection_id: connectionId, state } = request.query;
      const rows = await jobs.store.list({
        ...(connectionId === undefined ? {} : { connectionId }),
        ...(state === undefined ? {} : { state }),
      });
      return rows.map(jobBody);
    },
  );

  app.get(
    "/api/v1/jobs/:id",
    {
      preHandler: read,
      schema: {
        tags: ["jobs"],
        summary: "One job: state, progress and summary.",
        params: idParams,
        response: { 200: jobSchema, 404: errorBodySchema },
      },
    },
    async (request) => {
      const row = await jobs.store.get(request.params.id);
      if (row === undefined) throw notFound("job");
      return jobBody(row);
    },
  );

  const control = (
    verb: "cancel" | "resume" | "restart",
    summary: string,
    run: (id: string) => Promise<Parameters<typeof jobBody>[0]>,
  ): void => {
    app.post(
      `/api/v1/jobs/:id/${verb}`,
      {
        preHandler: write,
        schema: {
          tags: ["jobs"],
          summary,
          description: "409 `job_state` when the job's state does not allow it.",
          params: idParams,
          response: { 200: jobSchema, ...errors, 429: errorBodySchema },
        },
      },
      async (request) => jobBody(await run(request.params.id).catch(asApiError)),
    );
  };
  control("cancel", "Cancel a job; a running one stops at its next page.", (id) => jobs.cancel(id));
  control("resume", "Continue a stopped job from its checkpoint.", (id) => jobs.resume(id, false));
  control("restart", "Start a job over: its checkpoint and progress are dropped.", (id) =>
    jobs.resume(id, true),
  );
}

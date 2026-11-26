import { z } from "zod";
import { requestLanguage } from "../../i18n/language.js";
import { localizeSchema } from "../../i18n/translate.js";
import { CONSUMER_FIELDS } from "../../consumers/manifest.js";
import { notificationRulesSchema } from "../../consumers/rules.js";
import { ConsumerInputError, type ConsumerView } from "../../consumers/store.js";
import type { Services } from "../../services.js";
import type { TypedApp } from "../app.js";
import { requireScope } from "../auth-plugin.js";
import { ApiError, errorBodySchema, notFound } from "../errors.js";
import { idParams } from "../schemas.js";

/** Consumers and their notification rules (`docs/consumers.md`). */

const availableSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tier: z.enum(["builtin"]).describe("Installed consumers come with the registry."),
  fields: z.array(z.enum(CONSUMER_FIELDS)).describe("Parcel fields it gets beyond the texts."),
  hosts: z
    .array(z.string())
    .describe("Hosts it may reach: a name, or `config:<field>` for the host the user types there."),
  smtp: z.boolean(),
  config_schema: z.unknown().describe("JSON Schema of the settings form."),
  secret_schema: z.unknown().nullable().describe("JSON Schema of the secret form, if any."),
});

const consumerSchema = z.object({
  id: z.uuid(),
  consumer: z.string().describe("Which consumer: ntfy, email, webhook, apprise, …"),
  label: z.string(),
  config: z.unknown(),
  has_secret: z.boolean().describe("Whether a secret is stored. It is never returned."),
  rules: notificationRulesSchema,
  enabled: z.boolean(),
  last_attempt_at: z.string().nullable(),
  last_ok_at: z.string().nullable(),
  last_error: z.string().nullable().describe("Why the last attempt did not deliver."),
});

const outcomeSchema = z.object({
  ok: z.boolean(),
  retry: z.boolean().describe("Not delivered, but it may work later (the service was down)."),
  message: z.string().nullable(),
});

function toBody(view: ConsumerView): z.infer<typeof consumerSchema> {
  return {
    id: view.id,
    consumer: view.consumer,
    label: view.label,
    config: view.config,
    has_secret: view.hasSecret,
    rules: view.rules,
    enabled: view.enabled,
    last_attempt_at: view.lastAttemptAt,
    last_ok_at: view.lastOkAt,
    last_error: view.lastError,
  };
}

function asBadRequest(error: unknown): never {
  if (error instanceof ConsumerInputError) {
    throw new ApiError(400, "invalid_consumer", error.message, {
      reason: error.code,
      detail: error.message,
    });
  }
  throw error;
}

const errors = { 400: errorBodySchema, 404: errorBodySchema };

export function registerConsumerRoutes(app: TypedApp, services: Services): void {
  const read = requireScope("read");
  const admin = requireScope("admin");

  app.get(
    "/api/v1/consumers/available",
    {
      preHandler: read,
      schema: {
        tags: ["consumers"],
        summary: "The consumers that can be added, with their forms.",
        response: { 200: z.array(availableSchema) },
      },
    },
    (request) => {
      const language = requestLanguage(request.headers["accept-language"]);
      const schema = (zod: z.ZodType): unknown =>
        localizeSchema(language, z.toJSONSchema(zod, { io: "input", unrepresentable: "any" }));
      return [...services.consumerCatalog.values()].map((consumer) => {
        const { manifest, configSchema, secretSchema } = consumer.describe();
        return {
          id: manifest.id,
          name: manifest.name,
          description: manifest.description,
          tier: "builtin" as const,
          fields: [...manifest.fields],
          hosts: manifest.permissions.network.map((entry) =>
            "host" in entry ? entry.host : `config:${entry.config}`,
          ),
          smtp: manifest.permissions.smtp,
          config_schema: schema(configSchema),
          secret_schema: secretSchema === null ? null : schema(secretSchema),
        };
      });
    },
  );

  app.get(
    "/api/v1/consumers",
    {
      preHandler: read,
      schema: {
        tags: ["consumers"],
        summary: "Configured consumers with their rules and last delivery.",
        response: { 200: z.array(consumerSchema) },
      },
    },
    async () => (await services.consumers.list()).map(toBody),
  );

  app.post(
    "/api/v1/consumers",
    {
      preHandler: admin,
      schema: {
        tags: ["consumers"],
        summary: "Add a consumer. Its secret is encrypted at rest and never returned.",
        body: z.object({
          consumer: z.string().min(1).max(40),
          label: z.string().min(1).max(80),
          config: z.unknown().default({}),
          secret: z.unknown().default(null),
          rules: notificationRulesSchema,
          enabled: z.boolean().default(true),
        }),
        response: { 201: consumerSchema, 400: errorBodySchema },
      },
    },
    async (request, reply) => {
      const { consumer, ...input } = request.body;
      const created = await services.consumers.create(consumer, input).catch(asBadRequest);
      return reply.code(201).send(toBody(created));
    },
  );

  app.patch(
    "/api/v1/consumers/:id",
    {
      preHandler: admin,
      schema: {
        tags: ["consumers"],
        summary: "Change a consumer's label, settings, secret, rules or switch it on or off.",
        description: "`secret`: leave it out to keep the stored one, null to remove it.",
        params: idParams,
        body: z.object({
          label: z.string().min(1).max(80).optional(),
          config: z.unknown().optional(),
          secret: z.unknown().optional(),
          rules: notificationRulesSchema.optional(),
          enabled: z.boolean().optional(),
        }),
        response: { 200: consumerSchema, ...errors },
      },
    },
    async (request) => {
      const updated = await services.consumers
        .update(request.params.id, request.body)
        .catch(asBadRequest);
      if (updated === undefined) throw notFound("consumer");
      return toBody(updated);
    },
  );

  app.delete(
    "/api/v1/consumers/:id",
    {
      preHandler: admin,
      schema: {
        tags: ["consumers"],
        summary: "Remove a consumer and its queued notifications.",
        params: idParams,
        response: { 204: z.null(), 404: errorBodySchema },
      },
    },
    async (request, reply) => {
      if (!(await services.consumers.remove(request.params.id))) throw notFound("consumer");
      return reply.code(204).send(null);
    },
  );

  app.post(
    "/api/v1/consumers/:id/test",
    {
      preHandler: admin,
      schema: {
        tags: ["consumers"],
        summary: "Send a test notification now, past the rules and the queue.",
        params: idParams,
        response: { 200: outcomeSchema, 404: errorBodySchema },
      },
    },
    async (request) => {
      const view = await services.consumers.get(request.params.id);
      if (view === undefined) throw notFound("consumer");
      const outcome = await services.notifications.test(view);
      return {
        ok: outcome.kind === "ok",
        retry: outcome.kind === "retry",
        message: outcome.kind === "ok" ? null : outcome.message,
      };
    },
  );
}

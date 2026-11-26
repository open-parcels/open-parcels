import { z } from "zod";
import { snakeCased } from "../snake-case.js";
import { requestLanguage, type Language } from "../../i18n/language.js";
import { localizeSchema, providerText } from "../../i18n/translate.js";
import { InvalidConnectionConfigError, type SignInFlowInfo } from "../../engine/registry.js";
import type { ConnectionView } from "../../engine/connections.js";
import type { Services } from "../../services.js";
import type { TypedApp } from "../app.js";
import { requireScope } from "../auth-plugin.js";
import { ApiError, errorBodySchema, notFound } from "../errors.js";
import { connectionKindSchema } from "../../domain/parcel.js";
import { loadLogos, logoPath } from "../../logos.js";
import { registerLogoRoutes } from "./logos.js";
import { actionBody, actionSchema } from "./jobs.js";
import { MAIL_PROVIDER, mailConfigSchema, mailSecretSchema } from "../../mail/types.js";
import {
  carrierMessageSchema,
  idParams,
  providerKindSchema,
  stateReasonSchema,
} from "../schemas.js";

/** "45 seconds", "12 minutes", "3 hours": rounded up, for a message a person reads. */
export function waitText(seconds: number): string {
  if (seconds < 90) {
    return `${String(seconds)} seconds`;
  }
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 90) {
    return `${String(minutes)} minutes`;
  }
  return `${String(Math.ceil(minutes / 60))} hours`;
}

export const connectionSchema = z.object({
  id: z.uuid(),
  provider: z.string(),
  kind: connectionKindSchema,
  label: z.string(),
  config: z.unknown(),
  has_secret: z
    .boolean()
    .describe("Whether sign-in data is stored. The data itself is never returned."),
  state: z.enum(["ok", "idle", "needs_sign_in", "error", "disabled"]),
  state_reason: stateReasonSchema,
  carrier_message: carrierMessageSchema,
  next_run_at: z.string().nullable(),
  last_run_at: z.string().nullable(),
  last_ok_at: z.string().nullable(),
});

const carrierSchema = z.object({
  id: z.string(),
  name: z.string(),
  countries: z.array(z.string()),
  aliases: z
    .array(z.string())
    .describe("Other names people search for: former names, sub-brands, local names."),
  logo: z
    .string()
    .nullable()
    .describe(
      "Path of the provider's bundled logo (cache-busted by its content hash), or null: draw a " +
        "monogram instead.",
    ),
  connection_kinds: z.array(providerKindSchema),
  fallback: z
    .boolean()
    .describe(
      "A fallback tracking service, not a carrier: asked only about parcels no built-in carrier " +
        "follows or finds.",
    ),
  sign_in: z
    .string()
    .describe("Type of the default sign-in flow: none, credentials, api_key or interactive."),
  sign_in_flows: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        type: z.enum(["none", "credentials", "api_key", "interactive"]),
        kinds: z.array(providerKindSchema),
        conditional: z
          .boolean()
          .describe("Applies only to some configurations; ask the connection's own flow list."),
      }),
    )
    .describe("Every sign-in flow of the provider. Interactive ones run as sign-in attempts."),
  config_schema: z.unknown().describe("JSON Schema of the connection configuration form."),
  secret_schema: z
    .unknown()
    .describe(
      "JSON Schema of the sign-in data for credentials and api_key flows: field names only, never values.",
    ),
  actions: z
    .array(actionSchema)
    .describe("Buttons on its connection cards; `connection_kinds` says on which."),
});

export function toBody(view: ConnectionView): z.infer<typeof connectionSchema> {
  return snakeCased(view);
}

/** A flow as the carrier list shows it; per-flow fields come from the connection's own flow list. */
function flowSummary(
  language: Language,
  flow: SignInFlowInfo,
): z.infer<typeof carrierSchema>["sign_in_flows"][number] {
  return {
    id: flow.id,
    label: providerText(language, flow.label),
    type: flow.type,
    kinds: [...flow.kinds],
    conditional: flow.conditional,
  };
}

function asBadRequest(error: unknown): never {
  if (error instanceof InvalidConnectionConfigError) {
    throw new ApiError(400, "invalid_connection", error.message, {
      reason: error.reason,
      ...error.values,
    });
  }
  throw error;
}

/** The installed carrier providers, as the "Add a connection" form needs them. */
function registerCarrierRoutes(app: TypedApp, services: Services): void {
  const read = requireScope("read");
  const logos = loadLogos();
  registerLogoRoutes(app, services, logos);
  app.get(
    "/api/v1/carriers",
    {
      preHandler: read,
      schema: {
        tags: ["connections"],
        summary: "Installed carrier providers and how to set them up.",
        response: { 200: z.array(carrierSchema) },
      },
    },
    (request) => {
      const language = requestLanguage(request.headers["accept-language"]);
      const schema = (zod: z.ZodType): unknown =>
        localizeSchema(language, z.toJSONSchema(zod, { unrepresentable: "any" }));
      return services.registry.list().map((provider) => ({
        id: provider.info.id,
        name: provider.info.name,
        countries: [...provider.info.countries],
        aliases: [...provider.info.aliases],
        logo: logoPath(logos, provider.info.id, provider.info.logo),
        connection_kinds: [...provider.info.connectionKinds],
        fallback: provider.info.fallback,
        sign_in: provider.info.signIn,
        sign_in_flows: provider.info.signInFlows.map((flow) => flowSummary(language, flow)),
        config_schema: schema(provider.info.configSchema),
        secret_schema: schema(provider.info.secretSchema),
        actions: provider.info.actions.map((action) => actionBody(language, provider, action)),
      }));
    },
  );

  app.get(
    "/api/v1/inbox-form",
    {
      preHandler: read,
      schema: {
        tags: ["connections"],
        summary: "The inbox's configuration and sign-in forms (inboxes are no carrier provider).",
        response: {
          200: z.object({
            provider: z.literal(MAIL_PROVIDER),
            config_schema: z.unknown().describe("JSON Schema of the inbox configuration form."),
            secret_schema: z.unknown().describe("JSON Schema of the inbox sign-in data."),
            actions: z
              .array(actionSchema)
              .describe('The inbox\'s actions ("Read old emails again").'),
          }),
        },
      },
    },
    (request) => {
      const language = requestLanguage(request.headers["accept-language"]);
      const schema = (zod: z.ZodType): unknown =>
        localizeSchema(language, z.toJSONSchema(zod, { io: "input" }));
      const inbox = services.jobs.sourceOf(MAIL_PROVIDER);
      return {
        provider: MAIL_PROVIDER,
        config_schema: schema(mailConfigSchema),
        secret_schema: schema(mailSecretSchema),
        actions:
          inbox === undefined
            ? []
            : inbox.actions.map((action) => actionBody(language, inbox, action)),
      };
    },
  );
}

export function registerConnectionRoutes(app: TypedApp, services: Services): void {
  registerCarrierRoutes(app, services);
  const read = requireScope("read");
  const admin = requireScope("admin");

  app.get(
    "/api/v1/connections",
    {
      preHandler: read,
      schema: {
        tags: ["connections"],
        summary: "Carrier accounts, shops, tracking connections and inboxes.",
        response: { 200: z.array(connectionSchema) },
      },
    },
    async () => (await services.connections.list()).map(toBody),
  );

  app.post(
    "/api/v1/connections",
    {
      preHandler: admin,
      schema: {
        tags: ["connections"],
        summary: "Add a connection. Sign-in data is encrypted at rest and never returned.",
        body: z.object({
          provider: z.string().min(1).max(64),
          kind: z
            .enum(["account", "tracking", "shop", "mail"])
            .describe(
              'Inboxes use the provider "imap" with config {host, port, secure, allowPlaintext, folders, initialDays, checkSenders}.',
            ),
          label: z.string().min(1).max(80),
          config: z.unknown().default({}),
          secret: z.unknown().default(null),
        }),
        response: { 201: connectionSchema, 400: errorBodySchema },
      },
    },
    async (request, reply) => {
      const created = await services.connections.create(request.body).catch(asBadRequest);
      if (created.kind === "mail") {
        await services.mail.connect(created.id);
      }
      services.scheduler.wake();
      return reply.code(201).send(toBody(created));
    },
  );

  app.patch(
    "/api/v1/connections/:id",
    {
      preHandler: admin,
      schema: {
        tags: ["connections"],
        summary: "Rename, reconfigure, enable or disable a connection.",
        params: idParams,
        body: z.object({
          label: z.string().min(1).max(80).optional(),
          config: z.unknown().optional(),
          enabled: z.boolean().optional(),
        }),
        response: { 200: connectionSchema, 400: errorBodySchema, 404: errorBodySchema },
      },
    },
    async (request) => {
      const body = request.body;
      const updated = await services.connections
        .updateSettings(request.params.id, {
          ...(body.label === undefined ? {} : { label: body.label }),
          ...(body.config === undefined ? {} : { config: body.config }),
          ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
        })
        .catch(asBadRequest);
      if (updated?.kind === "mail") {
        await (updated.state === "disabled"
          ? services.mail.disconnect(updated.id)
          : services.mail.connect(updated.id));
      }
      if (updated === undefined) {
        throw notFound("connection");
      }
      if (body.enabled === true) {
        // Enabling makes the connection due at once; without a wake the run waited for the next
        // timer, up to minutes, while the card claimed it was due "just now".
        services.scheduler.wake();
      }
      return toBody(updated);
    },
  );

  app.put(
    "/api/v1/connections/:id/secret",
    {
      preHandler: admin,
      schema: {
        tags: ["connections"],
        summary: "Replace the sign-in data (credentials or API key) and run the connection.",
        params: idParams,
        body: z.object({ secret: z.unknown() }),
        response: { 204: z.null(), 400: errorBodySchema, 404: errorBodySchema },
      },
    },
    async (request, reply) => {
      if ((await services.connections.get(request.params.id)) === undefined) {
        throw notFound("connection");
      }
      // Checked against the provider's own schema before anything is stored.
      await services.connections
        .checkSecret(request.params.id, request.body.secret)
        .catch(asBadRequest);
      await services.connections.setSecret(request.params.id, request.body.secret);
      if ((await services.connections.get(request.params.id))?.kind === "mail") {
        await services.mail.connect(request.params.id);
      }
      services.scheduler.wake();
      return reply.code(204).send(null);
    },
  );

  app.post(
    "/api/v1/connections/:id/sync",
    {
      preHandler: requireScope("write"),
      schema: {
        tags: ["connections"],
        summary: "Run a connection now.",
        description:
          "While the connection backs off (a captcha pause or the carrier's rate limit) the run is " +
          "not brought forward: the answer is 429 `connection_backing_off` with `Retry-After`.",
        params: idParams,
        response: { 202: z.null(), 404: errorBodySchema, 429: errorBodySchema },
      },
    },
    async (request, reply) => {
      if ((await services.connections.get(request.params.id)) === undefined) {
        throw notFound("connection");
      }
      const { deferredUntil } = await services.connections.requestRun(request.params.id);
      if (deferredUntil !== null) {
        const seconds = Math.max(
          1,
          Math.ceil((Date.parse(deferredUntil) - services.clock.now().getTime()) / 1000),
        );
        void reply.header("retry-after", String(seconds));
        throw new ApiError(
          429,
          "connection_backing_off",
          `The carrier asked us to wait; this connection runs again in ${waitText(seconds)}.`,
          { seconds },
        );
      }
      services.scheduler.wake();
      return reply.code(202).send(null);
    },
  );

  app.delete(
    "/api/v1/connections/:id",
    {
      preHandler: admin,
      schema: {
        tags: ["connections"],
        summary: "Remove a connection and its stored sign-in.",
        params: idParams,
        response: { 204: z.null(), 404: errorBodySchema },
      },
    },
    async (request, reply) => {
      await services.mail.disconnect(request.params.id);
      if (!(await services.connections.delete(request.params.id))) {
        throw notFound("connection");
      }
      return reply.code(204).send(null);
    },
  );
}

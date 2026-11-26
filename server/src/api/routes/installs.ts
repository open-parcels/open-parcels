import { z } from "zod";
import { editDistance } from "../../installs/community.js";
import { InstallError, type InstalledRecord } from "../../installs/service.js";
import { blocked, INSTALL_KINDS, type InstallKind } from "../../installs/registry.js";
import type { Services } from "../../services.js";
import type { TypedApp } from "../app.js";
import { requireScope } from "../auth-plugin.js";
import { ApiError, errorBodySchema, notFound } from "../errors.js";

/**
 * The Providers page (decision record 0002 §2.8, §4 A–D): what is installed, what the registry and
 * the community offer, checking a repository, installing, auto-update and uninstalling. Providers,
 * themes and consumers go through the same routes, told apart by `kind`.
 */

const kind = z.enum(INSTALL_KINDS);
const tier = z.enum(["builtin", "verified", "custom", "community"]);

const installedSchema = z.object({
  kind,
  id: z.string(),
  name: z.string(),
  tier,
  version: z.string().nullable().describe("Null for built-in items: they update with the server."),
  repository: z.string().nullable(),
  commit: z.string().nullable(),
  auto_update: z.boolean(),
  auto_update_fixed: z
    .boolean()
    .describe("True for built-in items: always updated with open-parcels itself."),
});

const registrySchema = z.object({
  checked_at: z.string().nullable(),
  stale_days: z.number().int().describe("Days past the signed index's expiry; 0 while valid."),
  error: z.string().nullable(),
});

const availableSchema = z.object({
  kind: kind.nullable().describe("Null for community hits: their manifest is read on checking."),
  id: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  tier: z.enum(["verified", "community"]),
  repository: z.string(),
  version: z.string().nullable(),
  commit: z
    .string()
    .nullable()
    .describe("The reviewed commit of a verified item's newest version."),
  stars: z.number().int().nullable(),
  updated_at: z.string().nullable(),
  installed: z.boolean(),
  similar_to: z
    .string()
    .nullable()
    .describe("A verified or built-in id this community hit's name is close to (typosquatting)."),
});

const offerSchema = z.object({
  repository: z.string(),
  version: z.string(),
  commit: z.string(),
  items: z.array(
    z.object({
      kind,
      id: z.string(),
      folder: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      hosts: z.array(z.string()),
      refusal: z.enum(["needs_bundles", "invalid", "reserved", "blocked"]).nullable(),
      detail: z.string().nullable(),
    }),
  ),
});

const sourceSchema = z.enum(["url", "community", "verified"]);
const itemParams = z.object({ kind, id: z.string() });
const errors = { 400: errorBodySchema, 404: errorBodySchema };

function refused(error: unknown): never {
  if (error instanceof InstallError) {
    throw new ApiError(400, "install_refused", error.message, {
      reason: error.reason,
      detail: error.message,
    });
  }
  throw error;
}

function installedView(record: InstalledRecord): z.infer<typeof installedSchema> {
  return {
    kind: record.kind,
    id: record.id,
    name: record.name,
    tier: record.tier,
    version: record.version,
    repository: record.repository,
    commit: record.commit,
    auto_update: record.autoUpdate,
    auto_update_fixed: false,
  };
}

function builtinItems(services: Services): z.infer<typeof installedSchema>[] {
  const item = (itemKind: InstallKind, id: string, name: string) => ({
    kind: itemKind,
    id,
    name,
    tier: "builtin" as const,
    version: null,
    repository: null,
    commit: null,
    auto_update: true,
    auto_update_fixed: true,
  });
  return [
    ...services.registry
      .list()
      .map((provider) => item("provider", provider.info.id, provider.info.name)),
    ...services.themes.builtin.map((theme) => item("theme", theme.id, theme.name)),
    ...[...services.consumerCatalog.values()].map((consumer) => {
      const { manifest } = consumer.describe();
      return item("consumer", manifest.id, manifest.name);
    }),
  ];
}

/** The verified and built-in ids a community hit is checked against. */
function knownIds(services: Services, verified: readonly string[]): readonly string[] {
  return [...services.registry.list().map((provider) => provider.info.id), ...verified];
}

/** The Available tab: the registry's verified items, or community repositories from GitHub. */
async function availableItems(
  services: Services,
  source: "verified" | "community",
  refresh: boolean,
) {
  const installs = services.installs;
  const state = await installs.registry.read(refresh);
  const index = state.index;
  const installed = await installs.list();
  const isInstalled = (repository: string, id: string | null) =>
    installed.some(
      (record) => record.repository === repository && (id === null || record.id === id),
    );
  if (source === "verified") {
    const items = (index?.entries ?? [])
      .filter(
        (entry) =>
          blocked(index?.blocklist ?? [], { repository: entry.repository, id: entry.id }) === null,
      )
      .map((entry) => ({
        kind: entry.kind,
        id: entry.id,
        name: entry.name,
        description: null,
        tier: "verified" as const,
        repository: entry.repository,
        version: entry.versions[0]?.version ?? null,
        commit: entry.versions[0]?.commit ?? null,
        stars: null,
        updated_at: entry.versions[0]?.reviewed ?? null,
        installed: isInstalled(entry.repository, entry.id),
        similar_to: null,
      }));
    return { items, checked_at: state.checkedAt, error: state.error };
  }
  if (!installs.community) return { items: [], checked_at: null, error: null };
  const search = await installs.communitySearch.read(refresh);
  const verified = (index?.entries ?? []).map((entry) => entry.id);
  const known = knownIds(services, verified);
  const items = search.hits
    .filter((hit) => blocked(index?.blocklist ?? [], { repository: hit.repository }) === null)
    .filter((hit) => !(index?.entries ?? []).some((entry) => entry.repository === hit.repository))
    .map((hit) => {
      const name = hit.fullName.split("/")[1] ?? hit.fullName;
      const plain = name
        .toLowerCase()
        .replace(/^(op|open-parcels)[-_]/, "")
        .replace(/-/g, "_");
      return {
        kind: null,
        id: null,
        name,
        description: hit.description,
        tier: "community" as const,
        repository: hit.repository,
        version: null,
        commit: null,
        stars: hit.stars,
        updated_at: hit.updatedAt,
        installed: isInstalled(hit.repository, null),
        similar_to: known.find((id) => id !== plain && editDistance(id, plain) <= 2) ?? null,
      };
    });
  return { items, checked_at: search.checkedAt, error: search.error };
}

export function registerInstallRoutes(app: TypedApp, services: Services): void {
  const read = requireScope("read");
  const admin = requireScope("admin");
  const installs = services.installs;

  app.get(
    "/api/v1/providers/installed",
    {
      preHandler: read,
      schema: {
        tags: ["providers"],
        summary: "Installed providers, themes and consumers, built-in ones first.",
        response: {
          200: z.object({
            items: z.array(installedSchema),
            registry: registrySchema,
            remote: z
              .boolean()
              .describe("False: nothing is fetched (OPENPARCELS_PROVIDERS_REMOTE)."),
            community: z
              .boolean()
              .describe("Community discovery is on (OPENPARCELS_PROVIDERS_COMMUNITY)."),
          }),
        },
      },
    },
    async () => {
      const state = await installs.registry.read();
      const list = await installs.list();
      return {
        items: [...builtinItems(services), ...list.map(installedView)],
        registry: { checked_at: state.checkedAt, stale_days: state.staleDays, error: state.error },
        remote: installs.remote,
        community: installs.community,
      };
    },
  );

  app.get(
    "/api/v1/providers/available",
    {
      preHandler: read,
      schema: {
        tags: ["providers"],
        summary: "What can be installed: the registry's verified items, or community repositories.",
        querystring: z.object({
          source: z.enum(["verified", "community"]).default("verified"),
          refresh: z.stringbool().default(false).describe("Search again (at most once a minute)."),
        }),
        response: {
          200: z.object({
            items: z.array(availableSchema),
            checked_at: z.string().nullable(),
            error: z.string().nullable(),
          }),
        },
      },
    },
    async (request) => availableItems(services, request.query.source, request.query.refresh),
  );

  app.post(
    "/api/v1/providers/check",
    {
      preHandler: admin,
      schema: {
        tags: ["providers"],
        summary:
          "Reads what a git repository offers at a release tag or commit, for the consent screen.",
        body: z.object({
          url: z.string().max(300),
          ref: z
            .string()
            .max(100)
            .optional()
            .describe("Release tag or full commit; default: the newest release tag."),
        }),
        response: { 200: offerSchema, ...errors },
      },
    },
    async (request) => {
      const offer = await installs.check(request.body.url, request.body.ref).catch(refused);
      return { ...offer, items: offer.items.map((item) => ({ ...item, hosts: [...item.hosts] })) };
    },
  );

  app.post(
    "/api/v1/providers/install",
    {
      preHandler: admin,
      schema: {
        tags: ["providers"],
        summary: "Installs (or updates) one provider, theme or consumer a repository lists.",
        body: z.object({
          url: z.string().max(300),
          ref: z.string().max(100).optional(),
          kind,
          id: z.string().max(40),
          source: sourceSchema.describe(
            "Where the user found it: the URL dialog, the community list or the registry.",
          ),
        }),
        response: { 200: installedSchema, ...errors },
      },
    },
    async (request) => installedView(await installs.install(request.body).catch(refused)),
  );

  app.patch(
    "/api/v1/providers/:kind/:id",
    {
      preHandler: admin,
      schema: {
        tags: ["providers"],
        summary: "Switches auto-update of an installed item.",
        params: itemParams,
        body: z.object({ auto_update: z.boolean() }),
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      const { kind: itemKind, id } = request.params;
      if (!(await installs.setAutoUpdate(itemKind, id, request.body.auto_update)))
        throw notFound("route");
      return reply.code(204).send(null);
    },
  );

  app.delete(
    "/api/v1/providers/:kind/:id",
    {
      preHandler: admin,
      schema: {
        tags: ["providers"],
        summary: "Uninstalls an installed item; built-in ones cannot be uninstalled.",
        params: itemParams,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      if (!(await installs.uninstall(request.params.kind, request.params.id)))
        throw notFound("route");
      return reply.code(204).send(null);
    },
  );
}

import { z } from "zod";

/**
 * The repo manifest, format 1 (`open-parcels-repo.json` at a repository's root): what the
 * repository holds, one folder each (`docs/official-providers-repo.md`): providers, themes and
 * consumers. A folder is relative to the manifest, one or two path segments (`providers/dhl`).
 */
const segment = "[a-z0-9][a-z0-9_-]{0,60}";
const folder = z.string().regex(new RegExp(`^${segment}(/${segment})?$`));
const id = z.string().regex(/^[a-z0-9_]{2,40}$/);

/** `[{ id, folder }]`, no id twice. */
const entries = (what: string) =>
  z
    .array(z.strictObject({ id, folder }))
    .default([])
    .refine((list) => new Set(list.map((entry) => entry.id)).size === list.length, {
      message: `two ${what} share an id`,
    });

/** `[{ id, kind, folder }]`: a code provider runs its bundle, a declarative one is data only (0002 §2.1). */
const providers = z
  .array(z.strictObject({ id, kind: z.enum(["code", "declarative"]), folder }))
  .default([])
  .refine((list) => new Set(list.map((entry) => entry.id)).size === list.length, {
    message: "two providers share an id",
  });

const repoManifestSchema = z.strictObject({
  schema: z.literal(1),
  providers,
  themes: entries("themes"),
  /** Consumers (`docs/consumers.md` §6), each folder with its `open-parcels-consumer.json`. */
  consumers: entries("consumers"),
});
export type RepoManifest = z.infer<typeof repoManifestSchema>;

/** Parses a repo manifest; the error names the repository and every problem. */
export function parseRepoManifest(raw: unknown, where: string): RepoManifest {
  const parsed = repoManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new Error(`Repo manifest of ${where} is not valid: ${problems.join("; ")}`);
  }
  return parsed.data;
}

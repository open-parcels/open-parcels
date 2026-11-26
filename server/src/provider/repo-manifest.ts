import { z } from "zod";

/**
 * The repo manifest, format 1 (`open-parcels-repo.json` at a repository's root): what the
 * repository holds, one folder each (`docs/official-providers-repo.md`). Themes and consumers are
 * listed now; `providers` is added by the step that reads it from it, and until then the schema
 * refuses it like any unknown key.
 */
const folder = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,60}$/);

/** `[{ id, folder }]`, no id twice. */
const entries = (what: string) =>
  z
    .array(z.strictObject({ id: z.string().regex(/^[a-z0-9_]{2,40}$/), folder }))
    .default([])
    .refine((list) => new Set(list.map((entry) => entry.id)).size === list.length, {
      message: `two ${what} share an id`,
    });

const repoManifestSchema = z.strictObject({
  schema: z.literal(1),
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

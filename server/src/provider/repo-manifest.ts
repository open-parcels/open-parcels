import { z } from "zod";

/**
 * The repo manifest, format 1 (`open-parcels-repo.json` at a repository's root): what the
 * repository holds, one folder each (`docs/official-providers-repo.md`). Themes are listed now;
 * `providers` and `consumers` are added by the steps that read them from it, and until then the
 * schema refuses them like any unknown key.
 */
const folder = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,60}$/);

const repoManifestSchema = z.strictObject({
  schema: z.literal(1),
  themes: z
    .array(z.strictObject({ id: z.string().regex(/^[a-z0-9_]{2,40}$/), folder }))
    .default([])
    .refine((themes) => new Set(themes.map((theme) => theme.id)).size === themes.length, {
      message: "two themes share an id",
    }),
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

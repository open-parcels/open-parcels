import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadRules, withEmailRules, type EmailRuleDefinition } from "open-parcels-rules";
import { describe, expect, it } from "vitest";
import { BUILTIN_CARRIERS } from "../../src/engine/builtin-carriers.js";
import { emailResults } from "../../src/mail/interpret.js";
import { toMailInput } from "../../src/mail/watcher.js";
import { hostMatches } from "../../src/provider/manifest.js";

/*
 * The email rules of built-in providers (`docs/rules-split.md`): each rule's test vectors against
 * its made-up fixtures in `test/fixtures/email/<provider>/`, read as an inbox reads them.
 */

const FIXTURES = path.join(import.meta.dirname, "..", "fixtures", "email");
const rules = loadRules();

interface Vector {
  readonly fixture: string;
  readonly time_zone?: string;
  readonly now?: string;
  readonly expect: readonly Record<string, unknown>[];
}

const ruled = BUILTIN_CARRIERS.flatMap((provider) =>
  provider.emailRules === null
    ? []
    : [{ id: provider.info.id, manifest: provider.manifest, definitions: provider.emailRules }],
);

function vectors(definition: EmailRuleDefinition): readonly Vector[] {
  return definition.tests as readonly Vector[];
}

/** Every sender a rule reads: its domains, and the domains of its addresses. */
function senderDomains(definition: EmailRuleDefinition): string[] {
  const { domains = [], addresses = [] } = definition.senders as {
    domains?: string[];
    addresses?: string[];
  };
  return [...domains, ...addresses.map((address) => address.slice(address.indexOf("@") + 1))];
}

describe("email rules of built-in providers", () => {
  it("are those of the providers whose rules have moved so far", () => {
    expect(ruled.map((provider) => provider.id).sort()).toEqual([
      "amazon",
      "canadapost",
      "dhl",
      "dpd",
      "evri",
      "fedex",
      "hermes",
      "ups",
      "usps",
    ]);
  });

  for (const provider of ruled) {
    const own = withEmailRules(rules, provider.definitions);
    describe(provider.id, () => {
      for (const definition of provider.definitions) {
        for (const vector of vectors(definition)) {
          it(`${definition.id}: ${vector.fixture}`, async () => {
            const raw = readFileSync(path.join(FIXTURES, provider.id, vector.fixture));
            const mail = await toMailInput(raw, null, new Date("2027-01-01T00:00:00Z"));
            const dated = vector.now === undefined ? mail : { ...mail, date: new Date(vector.now) };
            const results = emailResults(own, dated, vector.time_zone ?? "UTC");
            expect(results).toHaveLength(vector.expect.length);
            vector.expect.forEach((expected, index) => {
              expect(results[index]).toMatchObject(expected);
            });
          });
        }
      }

      it("uses every fixture in its folder", () => {
        const used = new Set(
          provider.definitions.flatMap((definition) =>
            vectors(definition).map((vector) => vector.fixture),
          ),
        );
        expect(
          readdirSync(path.join(FIXTURES, provider.id)).filter((name) => !used.has(name)),
        ).toEqual([]);
      });

      it("reads only senders its manifest routes to it", () => {
        const routed = provider.manifest.email?.from_domains ?? [];
        // A rule domain also matches its subdomains, so it needs a leading-dot pattern.
        const uncovered = provider.definitions
          .flatMap(senderDomains)
          .filter((domain) => !routed.some((pattern) => hostMatches(pattern, `x.${domain}`)));
        expect(uncovered).toEqual([]);
      });
    });
  }

  it("never route one sender domain to two providers", () => {
    const readers = BUILTIN_CARRIERS.filter((provider) => provider.manifest.email !== undefined);
    const clashes = readers.flatMap((provider) =>
      (provider.manifest.email?.from_domains ?? []).flatMap((pattern) =>
        readers
          .filter((other) => other !== provider)
          .filter((other) =>
            (other.manifest.email?.from_domains ?? []).some(
              (theirs) =>
                hostMatches(theirs, pattern.replace(/^\./u, "")) ||
                hostMatches(pattern, theirs.replace(/^\./u, "")),
            ),
          )
          .map((other) => `${provider.info.id} ${pattern} / ${other.info.id}`),
      ),
    );
    expect(clashes).toEqual([]);
  });
});

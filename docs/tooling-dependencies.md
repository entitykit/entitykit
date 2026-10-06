# Development dependency compatibility

The October 6, 2026 dependency graph contains neither `braces` nor `sprintf-js`.
Both had unpatched advisories and previously required temporary exceptions.
The full npm audit now has zero known findings, with an empty exception list.
Runtime audits remain unconditional release gates.

Three scoped root overrides remove the affected paths without replacing Jest,
API Extractor, or the Next ESLint rules:

| Parent | Replacement | Compatibility requirement |
| --- | --- | --- |
| `@next/eslint-plugin-next` 16.3.8 | `fast-glob` is an npm alias for `tinyglobby` 0.2.17 | Preserve directory-only results, absolute/relative paths, and nonrecursive literal directory patterns |
| `@rushstack/ts-command-line` 5.3.17 | `argparse` 2.0.1 | Use its writable `format_usage` hook, omit undefined argument options, and preserve literal descriptions and epilogs |
| `@istanbuljs/load-nyc-config` 1.1.0 | `js-yaml` 4.3.2 | Its existing `load()` call supports ordinary YAML config and extended config files |

Argparse 2 includes the legacy API used by RushStack, with deprecation notices;
argparse 3 removes that compatibility and is not a safe substitution. The
remaining descriptions used as argument-help templates still escape percent
characters. Descriptions and epilogs are literal in argparse 2, so the install
patch removes escaping only from those fields. No new formatting implementation
or advisory suppression is introduced.

Tinyglobby defaults to expanding literal directories and returning relative
paths. Next's patched call disables expansion, selects absolute results for
absolute patterns, and removes trailing separators while preserving filesystem
roots. The alias is limited to this Next plugin; it is not a general replacement
for the complete fast-glob API.

`npm ci` runs [prepare-tooling.js](../scripts/prepare-tooling.js). It verifies the
replacement identities and exact versions, then checks all four affected source
files against [the recorded SHA-256 hashes](../config/tooling/compatibility-patches.json)
before writing any patch. Re-running it accepts exactly the reviewed patched
bytes. A changed version, changed source, or missing replacement stops the install.
`--ignore-scripts` skips this preparation and does not produce a qualified
development installation; run `node scripts/prepare-tooling.js` before using it.

The regression suite exercises Next root patterns, deeply nested brace input,
RushStack flags and argument values, invalid/required options, literal percent
text, API Extractor CLI help and refusals, YAML inheritance, idempotent patching,
and refusal of changed package versions or source bytes. Existing API reports,
Jest tests, coverage/mutation tooling, and Next verification remain required.

Future parent upgrades require reviewing these overrides and hashes together.
Remove an override and its patch when the parent adopts a compatible safe
dependency itself. Do not refresh a source hash merely to make installation pass.
The overrides and installer live in the private repository root and are excluded
from the seven published packages.

# Public API contracts

These version-controlled API Extractor reports cover ten public entrypoints
across all seven packages. They preserve exported declarations, overloads,
generic constraints, protected extension points, and the full definitions of
reachable types. `package-exports.json` separately protects module formats,
export maps, and the CLI executable map. EntityKit versions remain prereleases;
this is the reviewed baseline for preparing the first stable release.

Run `npm run check:api` to build the packages and compare their declarations
with these reports. The canonical verification and release CI gates include
this check. An ordinary check never overwrites an approved report. To propose
an intentional API change, run `npm run update:api` and review the resulting
diff together with its implementation, consumer tests, and compatibility
decision. Baseline generation is not evidence that a change is compatible.

API Extractor's `ae-forgotten-export` notes identify declarations reachable
through an entrypoint whose own names are exported elsewhere or intentionally
not exported there. Their complete shapes are included here so a change to
one of those types also requires review. This keeps provider, adapter, tooling,
and migration contracts visible without adding every name to the main import.
Missing TSDoc release tags are suppressed while this prerelease surface is
baselined; they do not suppress declaration changes.

`@entitykit/core/experimental` is outside the stable signature promise. Its
module address remains in the package export map, but it has no API report.
Implementation files, private members, diagnostics internals, and arbitrary
deep imports are outside the public entrypoint contract.

The gate's negative tests change a nested property type, generic constraint,
constructor, and overload, and verify that each is rejected while the original
approved report remains unchanged. Signature reports supplement runtime,
behavioral, strict type, migration compatibility, and packaged-consumer tests.

After the first stable release, patch releases preserve public source and
runtime compatibility and durable migration formats. Minor releases may add
compatible API but must preserve existing consumer behavior. Removals,
narrowed accepted inputs, widened outputs that break consumer narrowing,
required options, changed error codes, and changed query/tracking/transaction
semantics require an explicit compatibility decision and, when breaking, a
major release. Experimental features retain their documented exception.
Historical migrations and stored checksum/history records must continue to be
recognized; changing a package version does not authorize rewriting them.

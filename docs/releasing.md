# Releasing

EntityKit releases core, SQLite, Postgres, MySQL, NestJS, testing and CLI as one
exact versioned family. One source revision produces seven accepted tarballs.
Publication stages those files under a candidate tag; promotion verifies every
registry integrity before moving the public tags.

The supported path is the manual **Release** workflow in
[`.github/workflows/release.yml`](../.github/workflows/release.yml).
Every real working-copy publish is refused by `prepublishOnly`.
`npm run check:publish` performs marked dry runs; the historical
`check:publish-alpha` alias runs the same channel-aware check.

| Dispatch channel | Required version | Candidate tag | Public tag | Confirmation |
| --- | --- | --- | --- | --- |
| `alpha` | Canonical `X.Y.Z-alpha.N` | `alpha-candidate` | `alpha` | `publish-alpha` |
| `stable` | Canonical `X.Y.Z` | `stable-candidate` | `latest` | `publish-stable` |

Package versions currently remain `0.1.0-alpha.2`. Stable mechanics are tested
with synthetic versions, including real npm dry runs. A stable dispatch of
these prerelease tarballs fails preflight. Selecting and applying the first
stable version remains a separate release decision.

## Prepare the family

Choose one version for the root and all seven publishable packages. Update the
exact core peers, the CLI's development core pin, and every EntityKit dependency
in both private examples. Preserve the examples' own private package versions.
Regenerate the lockfile and keep
`packages/core/src/migrations/migration-metadata.ts`'s
`entityKitMigrationVersion` equal to core's version.

For a stable family, every published package's `publishConfig.tag` must be
`latest`; alpha families retain `alpha`. Keep access public and the repository
root private. The manifest, peer and package acceptance gates enforce this.

The API report contains the migration-version constant as a literal. A version
change therefore needs a reviewed `npm run update:api` as well as manifest and
lock changes. Review the full report diff: a metadata update does not authorize
an unrelated public signature or export change. Preserve historical migration
bodies, checksums, SQL, history rows and model snapshot formats; do not rewrite
an already-applied migration to reflect the SDK's new version.

Prepare user-facing notes describing the compatibility line, provider support,
upgrade procedure and any intentional breaking changes. Follow
[the compatibility policy](compatibility.md#stable-compatibility-policy) and
[the migration upgrade guide](upgrading.md).

## Qualify the candidate

Run `npm ci` and `npm run verify`. The canonical gate covers lint, scoped
security audits, types and unit tests; the Next.js production build; Bookshop's
SQLite checkout and process recovery; public API and export snapshots;
published-release migration compatibility; live SQLite operational recovery;
performance and resource budgets; seven packed consumers; and publication dry
runs.

The exact candidate on `main` must also pass the complete reusable CI matrix:

- the canonical gate on Node 22.13.0 and Node 24;
- runtime coverage and all required mutation campaigns;
- Postgres 18 and MySQL 8.4 integration, Bookshop, published-release migration
  upgrades, cancellation, deadlocks, commit-response loss, process crashes,
  database server recovery, and performance budgets;
- Next.js 16 production browser flows against Postgres 18.

Ordinary PRs run affected scoped mutation campaigns. The broad core campaign is
split into eight shards for nightly runs and release qualification. Release
dispatch passes `full-mutation: true` to the reusable CI workflow, forcing fresh
results from all 26 original campaigns on the release revision. All shards must
finish and their combined campaign score must meet the original floor. A green
PR or a nightly report from another revision does not replace this release gate.

The release workflow invokes that matrix for its own dispatch SHA and waits
for every lane before packing. Older green runs do not qualify a later commit.
The security tooling review must still be valid in the release window.

Ensure the `NPM_TOKEN` Actions secret is authorized for all seven identities.
Only the publish job receives OIDC write permission for npm provenance; tag
promotion holds no OIDC identity. Check npm organization policy and credentials
before the release window. Do not add credentials to the repository.

## Dispatch

Select `main`, choose `alpha` or `stable`, and type the matching confirmation.
The equivalent commands, to be used only for an authorized release, are:

```sh
gh workflow run release.yml --ref main -f channel=alpha -f confirm=publish-alpha
# After a stable version is selected, applied and qualified:
gh workflow run release.yml --ref main -f channel=stable -f confirm=publish-stable
```

Both channels share one concurrency group. The workflow rejects branches and
tags; it publishes only from `refs/heads/main`. Keep the release revision and
registry tags under one operator's control while the run completes.

## Accepted bytes and retry behavior

`check:package` builds and packs once into a retained directory, then accepts
those exact files as an external consumer. It proves Node16 and NodeNext types,
CommonJS and ESM entry points, real SQLite use, one shared core instance, the
installed CLI, peer-skew refusal, and a standalone Bookshop consumer. The
artifact contains the seven `.tgz` files plus the release policy from that same
qualified source. Publish and promotion download it without checking out,
compiling or repacking.

Preflight requires exactly the seven package identities, one version, the
selected channel and every manifest's public tag. It compares every current
public tag with the proposed version. A same-version retry is allowed;
backward movement, malformed versions, empty successful responses, network
errors and authentication failures stop the release. Only a clean E404 permits
an absent tag. Stable `latest` tags may be bootstrapped; a new alpha sibling may
be bootstrapped after the existing core alpha anchor has been checked.

Publication follows dependency order: core, SQLite, Postgres, MySQL, NestJS,
testing, then CLI. For each package:

- a clean E404 for the version allows publication with provenance under the
  candidate tag;
- an existing version whose SHA-512 integrity equals the accepted tarball is
  skipped on retry;
- an existing version with different bytes stops the release.

Before the first public tag moves, promotion verifies all seven registry
integrities and rechecks forward tag movement. Each tag update has three
bounded attempts, followed by verification of the complete public family.
There is no atomic operation across seven npm packages: a failed tag update
can leave a mixed family. Rerunning the same accepted release converges it;
the executed workflow tests qualify this recovery path. Candidate existence
alone is never sufficient for promotion.

## Verify publication

Preserve the run URL, full dispatch SHA, logs and `release-tarballs` artifact.
Set the chosen version and public tag (`alpha` or `latest`), then download the
accepted files and compare the registry:

```sh
export ENTITYKIT_RELEASE_VERSION=<chosen-version>
export ENTITYKIT_RELEASE_TAG=<alpha-or-latest>
export ENTITYKIT_RELEASE_RUN=<github-run-id>
export ENTITYKIT_ARTIFACT_DIR="$(mktemp -d)"
gh run download "$ENTITYKIT_RELEASE_RUN" --name release-tarballs \
  --dir "$ENTITYKIT_ARTIFACT_DIR"

set -euo pipefail
for name in core sqlite postgres mysql nestjs testing cli; do
  tarball="$ENTITYKIT_ARTIFACT_DIR/entitykit-$name-$ENTITYKIT_RELEASE_VERSION.tgz"
  accepted="sha512-$(openssl dgst -sha512 -binary "$tarball" | base64 | tr -d '\n')"
  published="$(npm view "@entitykit/$name@$ENTITYKIT_RELEASE_VERSION" dist.integrity | tr -d '[:space:]')"
  tagged="$(npm view "@entitykit/$name@$ENTITYKIT_RELEASE_TAG" version)"
  test "$published" = "$accepted"
  test "$tagged" = "$ENTITYKIT_RELEASE_VERSION"
  echo "verified @entitykit/$name@$ENTITYKIT_RELEASE_VERSION $accepted"
done
```

Install all seven through the selected public tag in a fresh consumer, without
`--force`, `--legacy-peer-deps` or overrides. Supply NestJS 12, `reflect-metadata`,
`rxjs`, `pg` and `mysql2` for their integrations. Check the installed CLI version,
load every declared entry point, run an application smoke test and inspect
`npm ls @entitykit/core --all` for one compatible core. Confirm each version's
npm provenance. Archive the accepted and registry integrities, dist-tag results
and clean-install output with the exact source SHA.

## Signed Git tag and GitHub Release

The workflow has `contents: read` and finishes after npm promotion. A Git tag
and GitHub Release are separate operator actions after public registry and
consumer verification. Use the configured zsumz PGP identity, the exact dispatch
SHA, reviewed notes and the downloaded accepted assets:

```sh
export ENTITYKIT_REPO="$(git rev-parse --show-toplevel)"
export ENTITYKIT_RELEASE_SHA=<full-dispatch-sha>
export ENTITYKIT_RELEASE_PRERELEASE=<true-for-alpha-or-false-for-stable>
export ENTITYKIT_RELEASE_NOTES="$ENTITYKIT_REPO/docs/releases/$ENTITYKIT_RELEASE_VERSION.md"

git -C "$ENTITYKIT_REPO" fetch origin main
git -C "$ENTITYKIT_REPO" tag --sign --message "v$ENTITYKIT_RELEASE_VERSION" \
  "v$ENTITYKIT_RELEASE_VERSION" "$ENTITYKIT_RELEASE_SHA"
git -C "$ENTITYKIT_REPO" push origin "v$ENTITYKIT_RELEASE_VERSION"
gh release create "v$ENTITYKIT_RELEASE_VERSION" "$ENTITYKIT_ARTIFACT_DIR"/*.tgz \
  --repo entitykit/entitykit --verify-tag \
  --prerelease="$ENTITYKIT_RELEASE_PRERELEASE" \
  --title "EntityKit $ENTITYKIT_RELEASE_VERSION" --notes-file "$ENTITYKIT_RELEASE_NOTES"
```

Verify the tag signature and target SHA, then inspect the release assets.
Preserve the accepted files before the Actions artifact's seven-day retention
expires. Release notes and support claims must match the accepted family.

## Recover an interrupted run

Before any publication, fix the failed gate or credential and qualify the new
source revision. Once a candidate version has published, keep the original
revision and accepted bytes for a retry. Matching versions are skipped;
missing candidates continue. If the bytes must change, choose a new exact
family version and qualify it again. Published versions are immutable.

After an interrupted promotion, rerun the accepted release to converge all
public tags. After npm succeeds, retry only missing Git or GitHub metadata
against the same SHA and assets. Do not unpublish and reuse versions, overwrite
signed tags, or promote individual family members by hand.

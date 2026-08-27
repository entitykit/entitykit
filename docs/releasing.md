# Releasing

EntityKit releases seven public packages as one versioned family:

```text
@entitykit/core
@entitykit/sqlite
@entitykit/postgres
@entitykit/mysql
@entitykit/nestjs
@entitykit/testing
@entitykit/cli
```

An alpha is not seven independent publishes. It is one accepted set of tarballs,
built from one commit, proven by the complete CI matrix, published under a
candidate tag when absent or accepted by exact integrity on retry, and promoted
only after the registry holds all seven exact files.

The supported publication path is the manual **Release alpha** GitHub Actions
workflow in [`.github/workflows/release.yml`](../.github/workflows/release.yml).
`npm run release:alpha` deliberately exits, and a plain working-copy
`npm publish` is guarded. The repository's acceptance script carries a private
marker for explicit `--dry-run --tag alpha` checks; every real working-copy
publish is refused. Do not bypass the workflow.

This guide describes the evidence a release must produce. It does not assert
that the current branch, hosted CI, npm credential, or registry state is ready;
verify each one again in the release window.

## Prepare the release

### 1. Move the family together

Choose one prerelease version, such as `0.1.0-alpha.2`, and apply it to every
publishable package. The six sibling packages must peer on
`@entitykit/core` at that exact version; the CLI's development link to core is
exact as well. Keep `entityKitMigrationVersion` in
`packages/core/src/migrations/migration-metadata.ts` equal to the package
version because every applied migration records it.

Keep the private Next.js demo's core, Postgres, and CLI pins on that same family
version so CI exercises the release candidate rather than the previous alpha.
Its exact `pg` version must also match the root development version used by the
workspace provider.

The repository tests enforce this family invariant. Do not loosen the peers to
a range to make a skewed release install.

### 2. Qualify the source and package boundary

Run the repository gate before pushing:

```sh
npm ci
npm run verify
```

`verify` covers lint, types, tests, the offline Next.js production build, all
seven packed-package acceptance paths, and alpha-publish guards. The package
check builds and packs once, then proves
the same seven files through a fresh unassisted install, Node16 and NodeNext type
consumers, CommonJS and ESM runtimes against SQLite, the installed CLI, one
shared core instance, and peer-skew rejection.

This local result is necessary but not the release verdict. The exact commit on
`main` must pass the complete reusable CI workflow:

- `npm run verify` on Node 22.13.0 and Node 24;
- runtime coverage;
- the critical-path mutation score;
- live Postgres 18 integration; and
- live MySQL 8.4 integration; and
- the Next.js 16 production demo against Postgres 18 through Playwright.

The release workflow invokes that complete matrix for its own ref and will not
pack until every lane is green. Never substitute an older green run or a
partial local test for this gate.

### 3. Set the publication credential

The workflow must be able to resolve an Actions secret named `NPM_TOKEN`, made
available at the repository or organization level. It must be valid for
`registry.npmjs.org` and authorized to publish every package in the `@entitykit`
scope. The publish job exposes it only as `NODE_AUTH_TOKEN`; its separate OIDC
permission supplies npm provenance.

Prove the credential and organization policy before the release window. A
missing, expired, under-scoped, or policy-incompatible token stops publication.
Do not add a fallback token to the repository or publish a missing member by
hand.

### 4. Freeze the release commit

Merge the release-ready state to `main` and record its full SHA. Keep `main`
unchanged until candidate publication and promotion finish. The workflow
refuses branches and tags: it publishes only `refs/heads/main`, and every
tarball is packed from the dispatch SHA.

## Dispatch the alpha

In GitHub Actions, open **Release alpha**, select `main`, choose **Run
workflow**, and enter the confirmation phrase exactly:

```text
publish-alpha
```

The equivalent GitHub CLI dispatch is:

```sh
gh workflow run release.yml --ref main -f confirm=publish-alpha
```

Watch the complete run and preserve its run id, commit SHA, logs, and
`release-tarballs` artifact as release evidence.

## What the workflow guarantees

The workflow advances through five barriers:

| Barrier | Guarantee |
| --- | --- |
| Confirm and guard | A human typed the phrase and the ref is `main` |
| Complete CI | Every release lane passed on the dispatch SHA |
| Evidence | Exactly seven tarballs were packed once and accepted as consumer artifacts |
| Candidate or retry acceptance | Absent versions were published with provenance under `alpha-candidate`; existing versions were accepted only when integrity matched |
| Promotion | Registry integrity matched all seven accepted files before any `alpha` tag moved |

### Accepted tarballs are immutable

The evidence job runs `check:package` with a retained output directory and
uploads those already-accepted `.tgz` files. Publish and promotion jobs download
that artifact; they do not check out source, rebuild, or repack.

Before publishing, the workflow reads each packed manifest and requires the
literal seven-package roster and one distinct version. For each package it then
computes the tarball's SHA-512 SRI and asks npm what, if anything, already
exists:

- an absent version is published with `--provenance --tag alpha-candidate`;
- the same version with the same integrity is an accepted partial-run retry and
  is skipped; and
- the same version with different integrity stops the release.

npm versions are immutable. A conflicting published version is never repaired
or overwritten; bump the entire family and produce a new release.

### Candidate first, alpha second

Candidate publication happens in dependency order: core, SQLite, Postgres,
MySQL, NestJS, testing, then CLI. The public `alpha` tag is untouched while packages
are still being uploaded.

Promotion first compares all seven registry integrities with the accepted
tarballs. Only after the whole set matches does it move each package's `alpha`
dist-tag to the new version. Each tag update gets three bounded attempts, and a
final registry pass proves all seven tags resolve to the family version before
the workflow succeeds. npm has no atomic multi-package tag operation, so a
failed promotion may still be briefly mixed; keep the release window closed to
installs and rerun the same accepted release until the final proof passes.

## Verify the public release

A green workflow is the beginning of release verification, not the end. Verify
the registry from outside the workflow using the retained artifact.

Set the version and run id, then download the exact accepted files:

```sh
export ENTITYKIT_REPO="$(git rev-parse --show-toplevel)"
export ENTITYKIT_RELEASE_VERSION=0.1.0-alpha.2
export ENTITYKIT_RELEASE_RUN=<github-run-id>
export ENTITYKIT_ARTIFACT_DIR="$(mktemp -d)"

gh run download "$ENTITYKIT_RELEASE_RUN" \
  --name release-tarballs \
  --dir "$ENTITYKIT_ARTIFACT_DIR"
```

Compare each accepted file with npm and prove the `alpha` tag resolves to the
same family version:

```sh
set -euo pipefail

for name in core sqlite postgres mysql nestjs testing cli; do
  tarball="$ENTITYKIT_ARTIFACT_DIR/entitykit-$name-$ENTITYKIT_RELEASE_VERSION.tgz"
  accepted="sha512-$(openssl dgst -sha512 -binary "$tarball" | base64 | tr -d '\n')"
  published="$(npm view "@entitykit/$name@$ENTITYKIT_RELEASE_VERSION" dist.integrity | tr -d '[:space:]')"
  tagged="$(npm view "@entitykit/$name@alpha" version | tr -d '[:space:]')"

  test "$published" = "$accepted"
  test "$tagged" = "$ENTITYKIT_RELEASE_VERSION"
  echo "verified @entitykit/$name@$ENTITYKIT_RELEASE_VERSION $accepted"
done
```

Then install through the public `alpha` tags in a clean consumer directory:

```sh
export ENTITYKIT_INSTALL_DIR="$(mktemp -d)"
cd "$ENTITYKIT_INSTALL_DIR"
npm init --yes
npm install \
  @entitykit/core@alpha \
  @entitykit/sqlite@alpha \
  @entitykit/postgres@alpha \
  @entitykit/mysql@alpha \
  @entitykit/nestjs@alpha \
  @entitykit/testing@alpha \
  @entitykit/cli@alpha \
  @nestjs/common@^12 @nestjs/core@^12 reflect-metadata rxjs \
  pg mysql2

./node_modules/.bin/entitykit --version
node -e "require('@entitykit/core'); require('@entitykit/sqlite'); require('@entitykit/postgres'); require('@entitykit/mysql'); require('@entitykit/testing')"
node --input-type=module -e "await import('@entitykit/nestjs')"
npm ls @entitykit/core --all
```

The CLI version must equal `ENTITYKIT_RELEASE_VERSION`, every import must load,
and `npm ls` must show one compatible core rather than a nested split. Also
confirm the provenance attestation is visible for each version on npm.

Archive the run URL, dispatch SHA, seven package identities, version, accepted
integrities, registry integrities, dist-tag results, and clean-install output.
These are the evidence that the published release is the release CI accepted.

## Create the Git tag and GitHub Release

The current release workflow has `contents: read` and stops after npm dist-tag
promotion. It does **not** create or push a Git tag, and it does **not** create a
GitHub Release. A green npm release must not be described as having either one.

Complete that metadata manually after public registry and install verification.
Use the configured zsumz signing identity, tag the exact dispatch SHA, and reuse
the downloaded accepted tarballs—never repack assets from a working tree:

```sh
export ENTITYKIT_RELEASE_SHA=<full-dispatch-sha>
export ENTITYKIT_RELEASE_NOTES="$ENTITYKIT_REPO/docs/releases/$ENTITYKIT_RELEASE_VERSION.md"

git -C "$ENTITYKIT_REPO" fetch origin main
git -C "$ENTITYKIT_REPO" tag --sign --message "v$ENTITYKIT_RELEASE_VERSION" \
  "v$ENTITYKIT_RELEASE_VERSION" \
  "$ENTITYKIT_RELEASE_SHA"
git -C "$ENTITYKIT_REPO" push origin "v$ENTITYKIT_RELEASE_VERSION"

gh release create \
  "v$ENTITYKIT_RELEASE_VERSION" \
  "$ENTITYKIT_ARTIFACT_DIR"/*.tgz \
  --repo entitykit/entitykit \
  --verify-tag \
  --prerelease \
  --title "EntityKit $ENTITYKIT_RELEASE_VERSION" \
  --notes-file "$ENTITYKIT_RELEASE_NOTES"
```

Review the release notes against the accepted artifact and exact compatibility
boundary before creating the release. Do not substitute an unreviewed generated
commit list for user-facing notes.

Verify the signed tag resolves to the dispatch SHA and inspect the GitHub
Release assets after upload. A pushed tag and a GitHub Release are distinct
objects; check both. The workflow artifact is retained for seven days, so
finish this step—or preserve the accepted files in controlled release
evidence—before it expires.

This is an operator step today, not hidden automation. If it is later moved
into Actions, the workflow and this guide must change together.

## Recover from an interrupted release

- **Before candidate publication:** fix the source, credential, or CI failure;
  bump the version if release bytes changed; then dispatch from the new green
  `main`.
- **After some candidates published:** keep `main` at the original release
  commit and re-dispatch the same version. Matching registry bytes are skipped
  and missing packages continue. If regenerated evidence differs, stop and
  bump the family.
- **After all candidates but before promotion:** re-dispatch from the same
  commit. Promotion will not begin until all seven integrities match.
- **During dist-tag movement:** the workflow retries each move three times and
  verifies the complete public family. If it still stops, rerun the same
  release; the integrity barrier remains valid and tag additions are repeatable.
- **After npm succeeds but tag or GitHub Release creation fails:** retry only
  the manual metadata step against the same SHA and accepted assets. Do not
  republish npm packages.

Never unpublish and reuse a version, overwrite a Git tag, promote only part of
the family by hand, or turn a partial candidate set into the public alpha. When
the accepted bytes must change, the only safe repair is a new exact family
version.

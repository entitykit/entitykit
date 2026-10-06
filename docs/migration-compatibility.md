# Published-release migration compatibility

The compatibility gate installs the actual published `0.1.0-alpha.1` and
`0.1.0-alpha.2` core, SQLite, Postgres and MySQL packages into separate consumers. Their registry
SHA-512 integrities are pinned in
[the alpha.1 fixture](../tests/fixtures/migration-compatibility/alpha-1.json) and
[the alpha.2 fixture](../tests/fixtures/migration-compatibility/alpha-2.json).
The old SDK creates a real application schema, applies its migration and
persists data before the candidate opens that database.

The candidate must:

- preserve the old migration SQL, checksum, model snapshot
  format and recorded history;
- read existing data and persist an optimistic version update;
- apply one new migration, preserve application data and roll the new
  migration back;
- reject a changed historical migration body.

The required-key repair makes new SQLite DDL explicitly reject null primary
keys. The original alpha.1 callback consequently renders different SQL and is
refused for its changed checksum; the campaign verifies that history stays
intact. A separate reviewed migration pins the published SQL, parameters and
transaction options, preserving the recorded digest for upgrade and rollback.
The original authored source and published fixtures are unchanged. Alpha.2
already includes the required-key repair, so its callback retains its digest
on all three providers. PostgreSQL and MySQL also retain their alpha.1 callback digests. This qualifies a reviewed
preservation procedure, rather than automatic compatibility for changed
callbacks; see [the migration guide](migrations.md).

These are executable database upgrades using a published predecessor. They
qualify the fixture's persistence contract on all three providers. An
application's own schema, hand-authored SQL and rollback still need rehearsal
with its real data, as described in [the upgrade procedure](upgrading.md).

## Run the campaign

```sh
npm run check:migration-compatibility
ENTITYKIT_COMPAT_DATABASE_URL=postgres://.../entitykit_test \
  npm run check:migration-compatibility:postgres
ENTITYKIT_COMPAT_DATABASE_URL=mysql://.../entitykit_test \
  npm run check:migration-compatibility:mysql
```

Use isolated databases: the campaign owns and resets its fixture objects.
Remote database names must identify a test, qualification or hardening target.
SQLite uses a disposable file. Keep temporary consumers outside the checkout;
the default operating-system temporary directory satisfies that boundary.

The default run installs a fresh legacy consumer from the pinned registry
artifacts for both baselines. To select one, pass its full version, for example
`npm run check:migration-compatibility -- 0.1.0-alpha.2`. For repeated local campaigns,
`ENTITYKIT_LEGACY_CONSUMER` can point to a previously installed consumer when
one release is selected; its exact package versions and lockfile
integrities are checked against the fixture before use. That optimization
does not replace preserving the historical artifact identities in release
evidence.

All three required CI provider lanes run this campaign. Preserve the candidate
SHA, historical fixture, provider/runtime versions and successful campaign
output with the release qualification. For a future predecessor or persisted
format, add an independently captured fixture and upgrade path; changing the
baseline alone does not demonstrate compatibility.

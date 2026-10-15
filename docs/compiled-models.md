# Explicit compiled models

`compileModel()` builds and owns mapping metadata once. A context selects the
handle with `options.useCompiledModel(handle)`. Its `configure()` hook still runs
for every instance; only its `model()` hook is skipped. Without this opt-in,
instance-dependent `model()` configuration keeps its existing behavior.

```ts
import {
    compileModel, DbContext, type DbContextOptionsBuilder,
} from '@entitykit/core';
import { createSqliteDataSource } from '@entitykit/sqlite';

class User {
    id = 0;
    name = '';
}

const mapping = compileModel(model => {
    model.entity(User, entity => {
        entity.toTable('users').hasKey(user => user.id);
        entity.property(user => user.id).hasColumnType('integer').isRequired();
        entity.property(user => user.name).hasColumnType('text').isRequired();
    });
}, { provider: 'sqlite' });

class AppContext extends DbContext {
    users = this.set(User);
    protected override configure(options: DbContextOptionsBuilder): void {
        options.useCompiledModel(mapping);
    }
}

const source = createSqliteDataSource('./app.db');
try {
    await using db = source.createContext(AppContext);
    const users = await db.users.asNoTracking().toArray();
} finally {
    await source.dispose();
}
```

The mapping is explicit application state. Create separate handles for different
schemas, tables or mapping variants; EntityKit does not cache by constructor.
Compilation runs synchronously and rejects asynchronous configuration. One
context options builder accepts one compiled-model selection.

## Ownership and supported mappings

Compilation copies finalized metadata, nested records and arrays, preserving
the shared identity of metadata referenced by lookup tables. Owned metadata is
frozen. Lookup facades expose no mutators and keep their backing Maps private,
including during `forEach`. Retaining or changing a builder cannot change the
handle. EntityKit does not freeze application constructors or their prototypes.

The initial API supports flat mappings without value converters, custom
materializers or complex properties. Object or function defaults, metadata
accessors/proxies and custom metadata prototypes are rejected. Primitive defaults
and built-in typed columns remain available. Entity constructors still run for
each materialized instance; compilation does not assume they are side-effect free
or bypass verified writes, query identity or captured persistence facts.

Use ordinary `model()` configuration for unsupported shapes. This is an explicit
error during compilation, not a silent partial cache. A callback's closed-over
state cannot be made immutable by freezing its function object; a shared callback
contract is outside this initial API.

## Provider and request boundaries

`CompiledModelOptions.provider` names the provider registration. `dialect`
defaults to that name; custom registrations may specify a different runtime
dialect name. Both names must match the context. Physical index-name validation
runs during compilation for that dialect. Incompatible handles are refused before
a provider connection factory runs. A structural lookalike is not a valid handle.

The handle contains no connections, tenants, entities, query parameters, trackers,
transactions, cancellation state or interceptors. Every context retains fresh
options and its own connection lease, guards, tracker and request callbacks.
Tenant-key mappings still require an explicit tenant resolver or cross-tenant
configuration on every context. A mutable tenant callback remains live on its
own context. Disposal and transaction rollback retain their existing ownership.

## Performance scope

This API reuses finalized mapping metadata. For eligible buffered flat root-field
projections, each execution also owns a copy of its projection instructions before
SQL compilation and resolves each mapped field once for all returned rows. SQL
and decoding use the same frozen instructions; changing a retained item while a
query is pending cannot change that execution. A later execution captures the
then-current shape. Caller-owned query objects are not frozen.

The first projection plan accepts ordinary dense arrays and plain data-only field
items, with no joins and no nested output paths. Computed/literal fields, nested
results, proxies/accessors, unsupported shapes and dynamic models retain the
existing mapper. The context value reader remains live for every value, including
its receiver, decoding order, null handling and synchronous-result checks. Output
objects remain fresh, plain objects with safe own properties for special aliases.

Projection plans, parameter values and result rows are not cached across executions
or contexts. Eligible flat entity mappings share a private field plan through their
compiled metadata identity. It resolves property paths and diagnostic names once,
and selects converter-free capture, verified writes and persistence-value cloning.
Constructors and readers remain live. Every field is captured before construction;
setters and proxies still receive writes followed by equivalent readback checks.
Mutable values retain their independent snapshots, query-local identities and
later attachment facts. Restoration scopes retain their failure-atomic path.

Query-local identity lookup and insertion retain separate encoding calls across
entity construction and writes. Immutable mapping metadata and primitive key
values alone do not make the encoding immutable: constructors can change
inherited JSON hooks or name coercion. Reusing a lookup string must not skip
those observations or break repeated-row identity.

Entity plans contain no readers, entities or request state. Frozen lookalikes and
ordinary dynamic metadata do not qualify. General SQL compilation is not
precompiled, and no performance multiplier is promised by this API.

Measure model construction separately from warm reads, and keep context and
connection policies equal when comparing compiled and dynamic modes. Large
typed reads may be dominated by materialization work that model reuse does not
remove. See [performance contracts](performance.md).

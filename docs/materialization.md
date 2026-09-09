# Rehydrate constructor-based entities

Use `materializeChecked()` when a class needs constructor arguments on reads:

```ts
entity.materializeChecked(row => new User({
  id: row.required(user => user.id),
  email: row.required(user => user.email),
  name: row.required(user => user.name),
}));
```

The application constructs its domain object. EntityKit checks each selected
mapped scalar and reports failures with its entity and property, such as
`Cannot materialize 'User.email': the mapped value is missing.` Values have
already passed through the provider reader and any configured value converter.
Reading a value again does not rerun that conversion.

`required()` rejects missing values and SQL `NULL`. `nullable()` accepts SQL
`NULL` only when the mapping is nullable; a missing column still fails. The row
contains checked accessors, not entity methods or loaded navigations. Selectors
may identify mapped scalar leaves within complex properties, but cannot select
a whole complex object or a navigation.

## Built-in checks

Automatic checks validate the normalized scalar representation:

| SQL mapping | Accepted value |
| --- | --- |
| Text, varchar, char, UUID | JavaScript string |
| Smallint, integer, serial | Safe integer number |
| Real, float, double precision | Finite number |
| Boolean | JavaScript boolean |
| Timestamp, timestamptz, datetime | Valid `Date` |
| Bytea, blob, binary, varbinary | `Uint8Array` |

Values are not coerced. These checks establish scalar representations and
nullability; database constraints and domain invariants remain their owners'
responsibility. String and number results are widened, so an unchecked SQL
string does not establish a TypeScript literal union or brand.

## Converted and domain values

Supply a synchronous type guard for converted values, custom SQL types, JSON,
arrays, bigint, decimal, or date-only mappings. These do not have one portable
model representation. A guard can also establish a narrower domain type:

```ts
type Status = "draft" | "published";
const isStatus = (value: unknown): value is Status =>
  value === "draft" || value === "published";

entity.materializeChecked(row => new Post({
  id: row.required(post => post.id),
  status: row.required(post => post.status, isStatus),
}));
```

A guard checks the model value after conversion. It must return exactly `true`
to accept a value. Guards should only inspect values; EntityKit cannot undo
application side effects. Nullable access skips the guard for SQL `NULL` after
checking the mapping's nullability.

## Custom materializers

`materialize(values => ...)` remains available for application-owned
rehydration. Its argument remains `Readonly<Partial<TEntity>>`; it does not
promise a complete entity. The last call to `materialize()` or
`materializeChecked()` selects the entity's rehydration policy.

Both factories must return a fresh entity synchronously. Normal identity
resolution, mapped-property assignment, and tracking still apply. Only values
read through the checked accessors receive these additional checks. Partial
raw SQL rows must provide every scalar that the factory requests.

Creation is separate: `db.users.create(input)` invokes the set's constructor
or creation factory, tracks the returned entity as Added, and executes no SQL.

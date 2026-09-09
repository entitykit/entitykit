# Type creation-capable sets

For application-local services, preserve the context's actual set type:

```ts
type Users = AppDbContext["users"];
```

For reusable code, `DbSetFor` preserves the constructor or factory's creation
arguments without repeating them:

```ts
import type { DbSetFor } from "@entitykit/core";

type Users = DbSetFor<typeof User, [id: string]>;
type Registrations = DbSetFor<typeof makeUser, [id: string]>;
```

The helper's entity type is the constructor or factory result. If a factory
returns a subclass while the set maps its base class, use the context's indexed
access type to retain that exact mapping. Key tuples stay explicit; runtime
mapping declarations cannot infer a TypeScript key signature.

## Constructor and factory contracts

`this.set(User)` infers the constructor's complete argument tuple. A constructor
with no arguments permits `create()` with no arguments; EntityKit does not
infer required creation data from mapped properties. For typed `find()` keys,
use `this.set<typeof User, [id: string]>(User)`. Existing
`this.set<User, [string]>(User)` declarations retain their query and tracking
contracts; switch the first type argument to `typeof User` to enable typed
constructor creation.

Keep set declarations inferred: `readonly users = this.set(User)` preserves
creation arguments. An annotation such as `readonly users: DbSet<User> =
this.set(User)` erases those arguments and intentionally makes `create()`
unavailable. Use `DbSetFor<typeof User, [id: string]>` for a constructor-aware annotation.
The three-parameter `DbSet<User, [id: string], [input: NewUser]>` form remains
available when a reusable contract explicitly owns all three types.

Creation factories can accept inputs that differ from persisted properties:

```ts
// A context field; its factory belongs only to this returned set.
readonly registrations = this.set(User, {
  create: (input: { id: string; email: string; displayName: string }) =>
    new User({ id: input.id, email: input.email, name: input.displayName.trim() }),
});
```

Factory-bound sets share the context's tracker. They do not replace the factory
or constructor used by another set reference. Factories must return a fresh
instance of the mapped class synchronously; promises and already-tracked
instances are rejected. Private constructors and domain creation policies can
use this explicit factory route. Factories are invoked unbound, with `this`
set to `undefined`; preserve a method receiver with
`userFactory.make.bind(userFactory)` or a closure such as
`(id: string) => userFactory.make(id)`.

The entity argument defines what the set contains. A factory may return a
subclass, but `set(User, { create: factory })` still queries and returns the
mapped `User` type. Broad `object` results and unions containing non-user
values do not satisfy that contract.

For a reusable factory, `satisfies` checks the result while preserving inputs:

```ts
import type { EntityCreationFactory } from "@entitykit/core";

const makeUser = (
  (input: NewUser) => new User(input)
) satisfies EntityCreationFactory<User>;
```

An explicit annotation should include the argument tuple, such as
`EntityCreationFactory<User, [input: NewUser]>`. Omitting the tuple erases the
inputs and makes creation unavailable; it does not mean the factory takes no
arguments. Use `EntityCreationFactory<User, []>` for a real zero-argument
factory. The same tuple rule applies to `EntityCreationConstructor`.

For an explicitly typed key on a factory-bound set, use
`this.set<User, typeof makeUser, [id: string]>(User, { create: makeUser })`.
Ordinary factory bindings need no explicit type arguments.

Creation runs the ordinary `add()` enrollment path, including tenant defaults
and rollback on failure. It does not recursively insert navigation objects.
The entity materializer handles reads separately; reads never invoke
the set's creation factory. TypeScript contracts do not validate unchecked
request input, and EntityKit cannot roll back external side effects inside a
domain constructor or factory.

## Unions and overloads

Creation arguments must be accepted by every member of a constructor or factory
union. A union of a string-input factory and a number-input factory therefore
does not permit either call. Overloads use the same effective argument
signature as `set()`; they do not turn `create()` into a union of overloads.
Factory result and receiver checks still apply when registering the set.

`DbSetFor` rejects asynchronous factory results. Its defaults preserve erased
creation inputs as uncallable. It never restores information lost through an
identity-only constructor or an erased argument tuple.

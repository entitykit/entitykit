import { DbContext, type DbSet, type EntityConstructor, type EntityCreationConstructor, type EntityCreationFactory, type EntityEntry } from '@entitykit/core';

type NewUser = { id: string; name: string };
class User {
    public id: string;
    public name: string;
    constructor(input: NewUser) { this.id = input.id; this.name = input.name; }
}
class Defaults { public id = 'generated'; }
class TupleEntity {
    constructor(public id: string, public name = 'Default', ..._flags: boolean[]) {}
}
class PrivateUser {
    public id: string;
    public name: string;
    private constructor(input: NewUser) { this.id = input.id; this.name = input.name; }
    public static build(input: { code: number }): PrivateUser {
        return new PrivateUser({ id: String(input.code), name: 'Private' });
    }
}
abstract class AbstractUser { public id = ''; }
class ConcreteUser extends AbstractUser {}

class CreationTypesContext extends DbContext {
    public users = this.set(User);
    public keyed = this.set<typeof User, [id: string]>(User);
    public legacy: DbSet<User, [string]> = this.set<User, [string]>(User);
    public defaults = this.set(Defaults);
    public tuples = this.set(TupleEntity);
    public privateUsers = this.set(PrivateUser, { create: PrivateUser.build });
    public privateKeyed = this.set<PrivateUser, typeof PrivateUser.build, [id: string]>(
        PrivateUser, { create: PrivateUser.build },
    );
    public abstractUsers = this.set(AbstractUser, { create: () => new ConcreteUser() });
}

declare const db: CreationTypesContext;
declare const identity: EntityConstructor<User>;
const user: User = db.users.create({ id: 'ada', name: 'Ada' });
const entry: EntityEntry<User> = db.users.add(user);
void entry;
// @ts-expect-error missing constructor argument
db.users.create();
// @ts-expect-error required construction data cannot be omitted
db.users.create({});
// @ts-expect-error a misspelled property is rejected
db.users.create({ id: 'ada', naem: 'Ada' });
// @ts-expect-error runtime value types are checked
db.users.create({ id: 'ada', name: 42 });
// @ts-expect-error fresh literals cannot add unmapped input properties
db.users.create({ id: 'ada', name: 'Ada', extra: true });
db.keyed.create({ id: 'ada', name: 'Ada' });
void db.keyed.find('ada');
// @ts-expect-error typed keys remain checked
void db.keyed.find(42);
// @ts-expect-error key typing does not erase creation requirements
db.keyed.create({});
void db.legacy.find('ada');
// @ts-expect-error existing entity/key declarations still reject incorrect keys
void db.legacy.find(42);
// @ts-expect-error identity-only types do not claim a constructor contract
db.legacy.create({ id: 'ada', name: 'Ada' });
// @ts-expect-error loose entity identity does not imply a public constructor
db.set(identity).create();
const defaults: Defaults = db.defaults.create();
void defaults;
// @ts-expect-error a zero-argument constructor accepts no property-assignment input
db.defaults.create({ id: 'manual' });
db.tuples.create('one');
db.tuples.create('two', 'Second', true, false);
// @ts-expect-error required tuple arguments remain required
db.tuples.create();
// @ts-expect-error rest argument types are preserved
db.tuples.create('three', 'Third', 1);
const privateUser: PrivateUser = db.privateUsers.create({ code: 1 });
void privateUser;
// @ts-expect-error the factory input is distinct from the entity's properties
db.privateUsers.create({ id: 'one', name: 'One' });
// @ts-expect-error factory fields retain their declared types
db.privateUsers.create({ code: 'one' });
// @ts-expect-error factory input is required
db.privateUsers.create();
// @ts-expect-error a private constructor requires an explicit factory
db.set(PrivateUser).create({ id: 'one', name: 'One' });
void db.privateKeyed.find('one');
// @ts-expect-error factory-bound key types remain checked
void db.privateKeyed.find(1);
// @ts-expect-error specifying a key does not erase factory arguments
db.privateKeyed.create({ code: 'one' });
db.privateKeyed.create({ code: 1 });
// @ts-expect-error async factories cannot return an entity synchronously
db.set(User, { create: async (input: NewUser) => new User(input) });
// @ts-expect-error factories must return the mapped entity type
db.set(User, { create: () => ({ different: true }) });
// @ts-expect-error an abstract entity requires a factory for creation
db.set(AbstractUser).create();
const abstractUser: AbstractUser = db.abstractUsers.create();
void abstractUser;

// A factory annotation must not cause overload inference to widen to any.
declare const annotatedFactory: EntityCreationFactory<User, [input: NewUser]>;
const annotated = db.set(User, { create: annotatedFactory });
type IsAny<T> = 0 extends (1 & T) ? true : false;
const annotatedUser = annotated.create({ id: 'ada', name: 'Ada' });
const precise: IsAny<typeof annotatedUser> = false;
void precise;
// @ts-expect-error the annotated factory still returns the mapped user
annotated.create({ id: 'ada', name: 'Ada' }).unknownProperty;

declare const annotatedConstructor: EntityCreationConstructor<User, [input: NewUser]>;
const constructedUser = db.set(annotatedConstructor).create({ id: 'ada', name: 'Ada' });
const preciseConstructor: IsAny<typeof constructedUser> = false;
void preciseConstructor;
// @ts-expect-error annotated constructor results also retain the entity type
constructedUser.unknownProperty;

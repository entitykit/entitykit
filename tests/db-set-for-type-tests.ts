import { DbContext, type DbSetFor, type EntityCreationConstructor, type EntityCreationFactory } from '../packages/core/src';

class User {
    constructor(public id: string, public name = 'Default', ...flags: boolean[]) {
        void flags;
    }
}
const makeUser = (id: number): User => new User(String(id));
class Context extends DbContext {
    public readonly users: DbSetFor<typeof User, [id: string]> = this.set<typeof User, [id: string]>(User);
    public readonly factory: DbSetFor<typeof makeUser, [id: string]> =
        this.set<User, typeof makeUser, [id: string]>(User, { create: makeUser });
}
declare const db: Context;
const users: Context['users'] = db.users;
const created: User = users.create('one', 'Ada', true);
users.create('two');
void users.find('one');
db.factory.create(1);
// @ts-expect-error creation arguments remain required
users.create();
// @ts-expect-error constructor arguments retain their types
users.create(1);
// @ts-expect-error rest arguments retain their types
users.create('one', 'Ada', 1);
// @ts-expect-error explicit key tuples remain checked
void users.find(1);
// @ts-expect-error factory arguments stay independent of constructor arguments
db.factory.create('one');

declare const erased: DbSetFor<EntityCreationConstructor<User>>;
declare const erasedFactory: DbSetFor<EntityCreationFactory<User>>;
// @ts-expect-error erased constructors do not establish creation inputs
erased.create();
// @ts-expect-error erased factories do not establish creation inputs
erasedFactory.create('one');

declare const union: DbSetFor<((id: string) => User) | ((id: number) => User)>;
// @ts-expect-error inputs must be safe for every possible factory
union.create('one');
// @ts-expect-error inputs must be safe for every possible factory
union.create(1);
declare const asyncSet: DbSetFor<(id: string) => Promise<User>>;
// @ts-expect-error asynchronous factories cannot establish a synchronous set
asyncSet.create('one'); // eslint-disable-line @typescript-eslint/no-unsafe-call -- Intentional invalid creation contract.

interface OverloadedConstructor {
    new (id: string, active: boolean): User;
    new (id: number): User;
}
declare const overloaded: DbSetFor<OverloadedConstructor>;
overloaded.create(1);
// @ts-expect-error helper follows the same effective overload as set()
overloaded.create('one', true);
void created;

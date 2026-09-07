import './async-dispose-compat';
import { DbContext, type EntityCreationFactory, type EntityCreationConstructor } from '@entitykit/core';

class User {
    public name = '';
    constructor(public id: string) {}
}
class SpecialUser extends User { public role = 'special'; }
declare const db: DbContext;
const makeSpecial = (id: string): SpecialUser => new SpecialUser(id);
const specialUsers = db.set(User, { create: makeSpecial });
const user: User = specialUsers.create('ada');
void user;
// @ts-expect-error a factory cannot redefine the mapped set to promise subclass members
specialUsers.create('ada').role;
// @ts-expect-error queries materialize the mapped entity, not the factory-specific subtype
void specialUsers.toArray().then(users => users[0].role);
// @ts-expect-error a required factory argument stays required
specialUsers.create();
// @ts-expect-error a factory argument keeps its declared type
specialUsers.create(42);
// @ts-expect-error broad object results do not prove the mapped entity shape
db.set(User, { create: (_id: string): object => ({ definitelyNotAUser: true }) });
// @ts-expect-error a union containing a non-entity result is rejected
db.set(User, { create: (id: string): User | { id: string } => ({ id }) });
// @ts-expect-error a nullable result is not a synchronous entity factory
db.set(User, { create: (_id: string): User | null => null });
// @ts-expect-error factory results must include every mapped entity member
db.set(User, { create: (id: string): { id: string } => ({ id }) });
const keyed = db.set<User, typeof makeSpecial, [id: string]>(User, { create: makeSpecial });
keyed.create('ada');
void keyed.find('ada');
// @ts-expect-error explicit key typing remains precise
void keyed.find(123);
// @ts-expect-error explicit key typing does not erase creation arguments
keyed.create();

const annotated: EntityCreationFactory<User, [id: string]> = id => new User(id);
db.set(User, { create: annotated }).create('ada');
// @ts-expect-error a parameter-preserving annotation keeps required inputs
db.set(User, { create: annotated }).create();
const erased: EntityCreationFactory<User> = (id: string) => new User(id);
// @ts-expect-error an erased annotation does not establish zero-argument creation
db.set(User, { create: erased }).create();
// @ts-expect-error an erased annotation cannot recover its original inputs
db.set(User, { create: erased }).create('ada');
const satisfied = ((id: string) => new User(id)) satisfies EntityCreationFactory<User>;
db.set(User, { create: satisfied }).create('ada');
// @ts-expect-error satisfies preserves the original required input
db.set(User, { create: satisfied }).create();
const noArguments: EntityCreationFactory<User, []> = () => new User('generated');
db.set(User, { create: noArguments }).create();
// @ts-expect-error an explicit zero-argument tuple permits no extra arguments
db.set(User, { create: noArguments }).create('ada');
const optional: EntityCreationFactory<User, [id?: string]> = (id = 'generated') => new User(id);
db.set(User, { create: optional }).create();
db.set(User, { create: optional }).create('ada');
const variadic: EntityCreationFactory<User, [id: string, ...labels: string[]]> = id => new User(id);
db.set(User, { create: variadic }).create('ada', 'first', 'second');
// @ts-expect-error required arguments before a rest parameter remain required
db.set(User, { create: variadic }).create();
// @ts-expect-error rest argument types remain precise
db.set(User, { create: variadic }).create('ada', 42);

declare const erasedConstructor: EntityCreationConstructor<User>;
// @ts-expect-error erased constructor arguments do not establish zero-argument creation
db.set(erasedConstructor).create();
declare const legacyErasedConstructor: new (...arguments_: never[]) => User;
// @ts-expect-error a never[] constructor constraint is not a no-argument signature
db.set(legacyErasedConstructor).create();
declare const legacyErasedFactory: (...arguments_: never[]) => User;
// @ts-expect-error a never[] factory constraint is not a no-argument signature
db.set(User, { create: legacyErasedFactory }).create();

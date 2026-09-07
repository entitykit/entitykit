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

// A choice of factories must accept arguments safe for every possible callable.
declare const useObjectInput: boolean;
const factoryChoice = useObjectInput
    ? (input: { id: string }) => new User(input.id)
    : (id: string) => new User(id);
const choiceUsers = db.set(User, { create: factoryChoice });
// @ts-expect-error the selected factory might require an object
choiceUsers.create('ada');
// @ts-expect-error the selected factory might require a string
choiceUsers.create({ id: 'ada' });
const unionInput = (input: string | { id: string }) => new User(typeof input === 'string' ? input : input.id);
const unionUsers = db.set(User, { create: unionInput });
unionUsers.create('ada');
unionUsers.create({ id: 'ada' });
// @ts-expect-error a single union-input factory still rejects other inputs
unionUsers.create(42);
const sameInputChoice = useObjectInput
    ? (id: string) => new User(id)
    : (id: string) => new SpecialUser(id);
const sameInputUsers = db.set(User, { create: sameInputChoice });
sameInputUsers.create('ada');
// @ts-expect-error identical factory signatures preserve their required argument
sameInputUsers.create();
const overlappingChoice = useObjectInput
    ? (input: { id: string }) => new User(input.id)
    : (input: { id: string; name: string }) => new User(input.id + input.name);
const overlappingUsers = db.set(User, { create: overlappingChoice });
const sharedInput = { id: 'ada', name: 'Ada' };
overlappingUsers.create(sharedInput);
// @ts-expect-error inputs must satisfy both possible factory signatures
overlappingUsers.create({ id: 'ada' });
const optionalChoice = useObjectInput
    ? (id: string, _label?: string) => new User(id)
    : (id: string, _flag?: boolean) => new User(id);
const optionalChoiceUsers = db.set(User, { create: optionalChoice });
optionalChoiceUsers.create('ada');
// @ts-expect-error only the string-label factory accepts this second argument
optionalChoiceUsers.create('ada', 'label');
// @ts-expect-error only the boolean-flag factory accepts this second argument
optionalChoiceUsers.create('ada', true);
const restChoice = useObjectInput
    ? (id: string, ..._labels: string[]) => new User(id)
    : (id: string, ..._flags: boolean[]) => new User(id);
const restChoiceUsers = db.set(User, { create: restChoice });
restChoiceUsers.create('ada');
// @ts-expect-error rest arguments must be accepted by every possible factory
restChoiceUsers.create('ada', 'label');
// @ts-expect-error a different rest argument type does not satisfy both signatures
restChoiceUsers.create('ada', true);

declare const constructorChoice: (new (input: { id: string }) => User) | (new (id: string) => User);
const choiceConstructedUsers = db.set(constructorChoice);
// @ts-expect-error the selected constructor might require an object
choiceConstructedUsers.create('ada');
// @ts-expect-error the selected constructor might require a string
choiceConstructedUsers.create({ id: 'ada' });
declare const unionInputConstructor: new (input: string | { id: string }) => User;
db.set(unionInputConstructor).create('ada');
db.set(unionInputConstructor).create({ id: 'ada' });

const receiverFactory = {
    prefix: 'usr_',
    make(this: { prefix: string }, id: string): User { return new User(this.prefix + id); },
};
// @ts-expect-error factories are invoked unbound and cannot require a receiver
db.set(User, { create: receiverFactory.make });
// @ts-expect-error explicit public annotations must also reject a required receiver
const receiverAnnotation: EntityCreationFactory<User, [id: string]> = receiverFactory.make;
void receiverAnnotation;
// @ts-expect-error the public satisfies constraint must reject a required receiver
receiverFactory.make satisfies EntityCreationFactory<User>;
const boundUsers = db.set(User, { create: receiverFactory.make.bind(receiverFactory) });
boundUsers.create('ada');
// @ts-expect-error binding a receiver preserves required factory arguments
boundUsers.create();
// @ts-expect-error binding a receiver preserves factory argument types
boundUsers.create(42);
const closureUsers = db.set(User, { create: (id: string) => receiverFactory.make(id) });
closureUsers.create('ada');
// @ts-expect-error a receiver-preserving closure retains its argument type
closureUsers.create(42);
const explicitlyUnbound: EntityCreationFactory<User, [id: string]> = function (this: void, id: string) {
    return new User(id);
};
db.set(User, { create: explicitlyUnbound }).create('ada');

// Validate the same final overload whose arguments are exposed by create().
function overloadedResult(id: string): User;
function overloadedResult(id: number): { invalid: boolean };
function overloadedResult(id: string | number): User | { invalid: boolean } {
    return typeof id === 'string' ? new User(id) : { invalid: true };
}
// @ts-expect-error an earlier entity-returning overload cannot approve the exposed invalid result
db.set(User, { create: overloadedResult });
// @ts-expect-error explicit factory/key types must not bypass effective-signature validation
db.set<User, typeof overloadedResult, [id: string]>(User, { create: overloadedResult });
const selectedOverload = db.set(User, { create: (id: string) => overloadedResult(id) });
const selectedUser: User = selectedOverload.create('ada');
void selectedUser;
// @ts-expect-error a wrapper selecting the string overload rejects the invalid number path
selectedOverload.create(42);

declare function overloadedReceiver(this: void, id: string): User;
declare function overloadedReceiver(this: { prefix: string }, id: number): User;
// @ts-expect-error an earlier unbound overload cannot approve the exposed receiver-dependent path
db.set(User, { create: overloadedReceiver });
const receiverOverloadWrapper = db.set(User, { create: (id: string) => overloadedReceiver(id) });
receiverOverloadWrapper.create('ada');
const boundOverload = db.set(User, { create: overloadedReceiver.bind({ prefix: 'usr_' }) });
boundOverload.create(42);
// @ts-expect-error binding the receiver preserves the final overload's input
boundOverload.create('ada');

declare function nullableOverload(id: string): User;
declare function nullableOverload(id: number): User | null;
// @ts-expect-error final-overload validation must preserve nullable results
db.set(User, { create: nullableOverload });
declare function asyncOverload(id: string): User;
declare function asyncOverload(id: number): Promise<User>;
// @ts-expect-error a synchronous earlier overload cannot approve an exposed async result
db.set(User, { create: asyncOverload });
declare function zeroArgumentOverload(id: string): User;
declare function zeroArgumentOverload(): { invalid: boolean };
// @ts-expect-error zero-argument creation must validate the exposed result too
db.set(User, { create: zeroArgumentOverload });

// Earlier overloads need not be exposed when the final overload is safe.
function safeFinalOverload(this: { prefix: string }, id: string): { invalid: boolean };
function safeFinalOverload(this: void, id: number, label?: string, ...flags: boolean[]): User;
function safeFinalOverload(this: { prefix: string } | void, id: string | number, _label?: string, ..._flags: boolean[]): User | { invalid: boolean } {
    return typeof id === 'number' ? new User(String(id)) : { invalid: true };
}
const safeOverloadedUsers = db.set(User, { create: safeFinalOverload });
const safeOverloadedUser: User = safeOverloadedUsers.create(42);
void safeOverloadedUser;
safeOverloadedUsers.create(42, 'Ada', true, false);
// @ts-expect-error only the final overload's arguments are exposed
safeOverloadedUsers.create('ada');
// @ts-expect-error the effective overload's required argument remains required
safeOverloadedUsers.create();
// @ts-expect-error the effective overload's rest argument types stay precise
safeOverloadedUsers.create(42, 'Ada', 1);
// @ts-expect-error the returned entity type must not widen to any
safeOverloadedUsers.create(42).unknownProperty;
const safeKeyedOverload = db.set<User, typeof safeFinalOverload, [id: string]>(User, { create: safeFinalOverload });
safeKeyedOverload.create(42);
void safeKeyedOverload.find('42');
// @ts-expect-error keyed overload bindings retain their key tuple
void safeKeyedOverload.find(42);

// Choices of overloaded and ordinary factories must validate every effective signature.
const numericFactory = (id: number) => new User(String(id));
const resultOverloadChoice = useObjectInput ? overloadedResult : numericFactory;
// @ts-expect-error an ordinary entity factory cannot hide another branch's invalid exposed result
db.set(User, { create: resultOverloadChoice });
declare const receiverOverloadChoice: typeof overloadedReceiver | typeof numericFactory;
// @ts-expect-error an ordinary unbound factory cannot hide another branch's required receiver
db.set(User, { create: receiverOverloadChoice });
const safeOverloadChoice = useObjectInput ? safeFinalOverload : numericFactory;
db.set(User, { create: safeOverloadChoice }).create(42);

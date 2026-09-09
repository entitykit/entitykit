import type { DbSet, HavingPredicateExpression, PredicateExpression } from '@entitykit/core';

interface User { id: string; name: string; friends: User[] }
declare const users: DbSet<User>;
declare const left: PredicateExpression, right: PredicateExpression;
declare const having: HavingPredicateExpression;
declare const enabled: boolean, count: number;

users.where(user => user.id.eq('1') && user.name.eq('Ada')); // expect-predicate-error
users.where(user => user.id.eq('1') || user.name.eq('Ada')); // expect-predicate-error
users.where(() => left && right); // expect-predicate-error
users.where(() => left || right); // expect-predicate-error
const grouped = having && having; // expect-predicate-error
const groupedOr = having || having; // expect-predicate-error
users.include(user => user.friends.where(friend => friend.id.eq('1') && friend.name.eq('Ada'))); // expect-predicate-error

users.where(user => user.id.eq('1')).where(user => user.name.eq('Ada'));
users.where(user => user.id.eq('1').and(user.name.eq('Ada')));
users.where(() => left.or(right.not()));
users.whereIf(enabled && count > 0, user => user.name.eq('Ada'));
users.where(() => enabled ? left : right);
const acceptedHaving = having.and(having.or(having.not()));
void [grouped, groupedOr, acceptedHaving];

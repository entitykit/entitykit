import type { DbContext, DbSet, EntityEntry } from '@entitykit/core';

interface User { id: string; name: string }
declare const context: DbContext;
declare const users: DbSet<User>;
declare const user: User;
const entry: EntityEntry<User> = context.entryOrThrow(user);
const upsert: Promise<number> = users.executeUpsert([user], { conflictProperties: ['id'] });
context.clearTracking();
// @ts-expect-error upsert inputs retain the mapped entity shape
users.executeUpsert([{ id: 1 }]);
// @ts-expect-error conflict keys retain the mapped entity shape
users.executeUpsert([user], { conflictProperties: ['unknown'] });
void [entry, upsert];

import type { EntityMaterializationRow } from '@entitykit/core';

interface User {
    id: string;
    age: number;
    active: boolean;
    createdAt: Date;
    nickname: string | null;
    role: 'reader' | 'writer';
    profile: { locale: string };
}
declare const row: EntityMaterializationRow<User>;
const id: string = row.required(user => user.id);
const age: number = row.required(user => user.age);
const active: boolean = row.required(user => user.active);
const date: Date = row.required(user => user.createdAt);
const nickname: string | null = row.nullable(user => user.nickname);
void [id, age, active, date, nickname];
// @ts-expect-error string mappings do not prove a literal union
const role: User['role'] = row.required(user => user.role);
// @ts-expect-error custom model objects require an explicit guard
const profile: User['profile'] = row.required(user => user.profile);
// @ts-expect-error nullable reads cannot establish a required value
const name: string = row.nullable(user => user.nickname);
// @ts-expect-error selectors retain the entity shape
row.required(user => user.misspelled);
// @ts-expect-error a guard cannot change the selected property's model type
row.required(user => user.id, (value: unknown): value is number => typeof value === 'number');
const checked: User['role'] = row.required(user => user.role,
    (value: unknown): value is User['role'] => value === 'reader' || value === 'writer');
void [role, profile, name, checked];

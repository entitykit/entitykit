import { ModificationSqlBuilder } from '../src/sql/modification-sql-builder';
import {
    User,
    createUserMetadata,
    createUserRolesRelationship,
} from './modification-sql-builder-support';

describe('ModificationSqlBuilder batches', () => {
    it('compiles parameterized insert SQL', () => {
        const createdAt = new Date('2026-01-01T00:00:00.000Z');
        const user = new User({ id: 'usr_1', email: 'a@example.com', name: 'A', createdAt });

        expect(new ModificationSqlBuilder().buildInsert(createUserMetadata(), user)).toEqual({
            text: 'insert into "users" ("id", "email", "display_name", "created_at") values ($1, $2, $3, $4)',
            values: ['usr_1', 'a@example.com', 'A', createdAt],
        });
    });

    it('compiles batched entity inserts in row and property order', () => {
        const firstDate = new Date('2026-01-01T00:00:00.000Z');
        const secondDate = new Date('2026-01-02T00:00:00.000Z');
        const users = [
            new User({
                id: 'usr_1',
                email: 'a@example.com',
                name: 'A',
                createdAt: firstDate,
            }),
            new User({
                id: 'usr_2',
                email: 'b@example.com',
                name: 'B',
                createdAt: secondDate,
            }),
        ];

        expect(
            new ModificationSqlBuilder().buildInsertBatch(
                createUserMetadata(),
                users,
            ),
        ).toEqual({
            text: 'insert into "users" ("id", "email", "display_name", "created_at") values ($1, $2, $3, $4), ($5, $6, $7, $8)',
            values: [
                'usr_1',
                'a@example.com',
                'A',
                firstDate,
                'usr_2',
                'b@example.com',
                'B',
                secondDate,
            ],
        });
    });

    it('compiles provider-neutral batched upserts in row order', () => {
        const firstDate = new Date('2026-01-01T00:00:00.000Z');
        const secondDate = new Date('2026-01-02T00:00:00.000Z');
        const users = [
            new User({
                id: 'usr_1',
                email: 'a@example.com',
                name: 'A',
                createdAt: firstDate,
            }),
            new User({
                id: 'usr_2',
                email: 'b@example.com',
                name: 'B',
                createdAt: secondDate,
            }),
        ];

        expect(
            new ModificationSqlBuilder().buildUpsertBatch(
                createUserMetadata(),
                users,
            ),
        ).toEqual({
            text: 'insert into "users" ("id", "email", "display_name", "created_at") values ($1, $2, $3, $4), ($5, $6, $7, $8) on conflict ("id") do update set "email" = excluded."email", "display_name" = excluded."display_name", "created_at" = excluded."created_at"',
            values: [
                'usr_1',
                'a@example.com',
                'A',
                firstDate,
                'usr_2',
                'b@example.com',
                'B',
                secondDate,
            ],
        });
    });

    it('honors selected conflict and update properties in batched upserts', () => {
        const createdAt = new Date('2026-01-01T00:00:00.000Z');
        const user = new User({
            id: 'usr_2',
            email: 'a@example.com',
            name: 'Updated',
            createdAt,
        });

        expect(
            new ModificationSqlBuilder().buildUpsertBatch(
                createUserMetadata(),
                [user],
                {
                    conflictProperties: ['email'],
                    updateProperties: ['name'],
                },
            ),
        ).toEqual({
            text: 'insert into "users" ("id", "email", "display_name", "created_at") values ($1, $2, $3, $4) on conflict ("email") do update set "display_name" = excluded."display_name"',
            values: ['usr_2', 'a@example.com', 'Updated', createdAt],
        });
    });

    it('compiles composite many-to-many link batches in endpoint order', () => {
        expect(
            new ModificationSqlBuilder().buildInsertManyToManyBatch(
                createUserRolesRelationship(),
                [
                    [['tenant_1', 'usr_1'], 'role_1'],
                    [['tenant_1', 'usr_2'], 'role_2'],
                ],
            ),
        ).toEqual({
            text: 'insert into "app"."user_roles" ("tenant_id", "user_id", "role_id") values ($1, $2, $3), ($4, $5, $6) on conflict do nothing',
            values: [
                'tenant_1',
                'usr_1',
                'role_1',
                'tenant_1',
                'usr_2',
                'role_2',
            ],
        });
    });

    it('compiles batched outbox messages with optional columns parameterized', () => {
        const firstDate = new Date('2026-01-01T00:00:00.000Z');
        const secondDate = new Date('2026-01-02T00:00:00.000Z');
        const firstPayload = { email: 'a@example.com' };
        const secondPayload = { email: 'b@example.com' };

        expect(
            new ModificationSqlBuilder().buildInsertOutboxMessagesBatch({
                schemaName: 'app',
                tableName: 'outbox',
                typeColumn: 'event_type',
                payloadColumn: 'payload',
                aggregateIdColumn: 'aggregate_id',
                occurredAtColumn: 'occurred_at',
                messages: [
                    {
                        type: 'UserCreated',
                        payload: firstPayload,
                        aggregateId: 'usr_1',
                        occurredAt: firstDate,
                    },
                    {
                        type: 'UserCreated',
                        payload: secondPayload,
                        aggregateId: 'usr_2',
                        occurredAt: secondDate,
                    },
                ],
            }),
        ).toEqual({
            text: 'insert into "app"."outbox" ("event_type", "payload", "aggregate_id", "occurred_at") values ($1, $2, $3, $4), ($5, $6, $7, $8)',
            values: [
                'UserCreated',
                firstPayload,
                'usr_1',
                firstDate,
                'UserCreated',
                secondPayload,
                'usr_2',
                secondDate,
            ],
        });
    });

    it('rejects empty insert batches before producing SQL', () => {
        const builder = new ModificationSqlBuilder();

        expect(() => builder.buildInsertBatch(createUserMetadata(), []))
            .toThrow('At least one entity is required.');
        expect(() => builder.buildUpsertBatch(createUserMetadata(), []))
            .toThrow('At least one entity is required.');
        expect(() => builder.buildInsertManyToManyBatch(
            createUserRolesRelationship(),
            [],
        )).toThrow('At least one many-to-many pair is required.');
        expect(() => builder.buildInsertOutboxMessagesBatch({
            tableName: 'outbox',
            typeColumn: 'event_type',
            payloadColumn: 'payload',
            messages: [],
        })).toThrow('At least one outbox message is required.');
    });

});

import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';
import type { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import { mySqlDialect } from '../packages/mysql/src/mysql-dialect';
import { InsertSqlBuilder } from '../packages/core/src/sql/insert-sql-builder';
import {
    User,
    createUserMetadata,
    createUserRolesRelationship,
} from './modification-sql-builder-support';

class GeneratedRecord {
    public id = 0;
    public name!: string;
}

function generatedRecordMetadata(): EntityMetadata<GeneratedRecord> {
    const model = new ModelBuilderImplementation();
    model.entity(GeneratedRecord, entity => {
        entity.toTable('generated_records');
        entity.hasKey(row => row.id);
        entity.property(row => row.id)
            .hasColumnName('id').hasColumnType('integer').isRequired()
            .valueGeneratedOnAdd();
        entity.property(row => row.name)
            .hasColumnName('display_name').hasColumnType('text').isRequired();
    });
    return model.build().getEntity(GeneratedRecord);
}

describe('insert SQL builder', () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    it('delegates single-row batches and supports explicitly allowed missing values', () => {
        const incompleteUser = new User({
            id: 'usr_1',
            email: 'a@example.com',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
        });
        const completeUser = new User({
            id: incompleteUser.id,
            email: incompleteUser.email,
            name: 'A',
            createdAt: incompleteUser.createdAt,
        });
        const builder = new InsertSqlBuilder();

        expect(builder.buildInsert(createUserMetadata(), incompleteUser, ['name']))
            .toEqual({
                text: 'insert into "users" ("id", "email", "display_name", "created_at") values ($1, $2, $3, $4)',
                values: [
                    'usr_1',
                    'a@example.com',
                    undefined,
                    incompleteUser.createdAt,
                ],
            });
        expect(builder.buildInsertBatch(createUserMetadata(), [completeUser]))
            .toEqual(builder.buildInsert(createUserMetadata(), completeUser));
    });

    it('omits generated columns and uses returning only when supported', () => {
        const entity = new GeneratedRecord();
        entity.name = 'A';
        const metadata = generatedRecordMetadata();

        expect(new InsertSqlBuilder().buildInsert(metadata, entity)).toEqual({
            text: 'insert into "generated_records" ("display_name") values ($1) returning "id"',
            values: ['A'],
        });
        expect(new InsertSqlBuilder(mySqlDialect).buildInsert(metadata, entity))
            .toEqual({
                text: 'insert into `generated_records` (`display_name`) values (?)',
                values: ['A'],
            });
    });

    it('builds one composite many-to-many link through the single-row API', () => {
        expect(new InsertSqlBuilder().buildInsertManyToMany(
            createUserRolesRelationship(),
            ['tenant_1', 'usr_1'],
            'role_1',
        )).toEqual({
            text: 'insert into "app"."user_roles" ("tenant_id", "user_id", "role_id") values ($1, $2, $3) on conflict do nothing',
            values: ['tenant_1', 'usr_1', 'role_1'],
        });
    });

    it('builds a minimal single outbox message', () => {
        expect(new InsertSqlBuilder().buildInsertOutboxMessage({
            tableName: 'outbox',
            typeColumn: 'event_type',
            payloadColumn: 'payload',
            type: 'UserCreated',
            serializedPayload: '{"id":"usr_1"}',
        })).toEqual({
            text: 'insert into "outbox" ("event_type", "payload") values ($1, $2)',
            values: ['UserCreated', '{"id":"usr_1"}'],
        });
    });

    it('supplies the current time when an outbox timestamp is requested', () => {
        const now = new Date('2026-07-31T10:30:00.000Z');
        jest.useFakeTimers().setSystemTime(now);

        expect(new InsertSqlBuilder().buildInsertOutboxMessage({
            schemaName: 'app',
            tableName: 'outbox',
            typeColumn: 'event_type',
            payloadColumn: 'payload',
            aggregateIdColumn: 'aggregate_id',
            occurredAtColumn: 'occurred_at',
            type: 'UserCreated',
            serializedPayload: '{"id":"usr_1"}',
            aggregateId: 'usr_1',
        })).toEqual({
            text: 'insert into "app"."outbox" ("event_type", "payload", "aggregate_id", "occurred_at") values ($1, $2, $3, $4)',
            values: ['UserCreated', '{"id":"usr_1"}', 'usr_1', now],
        });
    });
});

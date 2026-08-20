import type { SqlDialect } from '../packages/core/src/adapter';
import { createQueryProxy } from '../packages/core/src/experimental';
import { ModificationSqlBuilder } from '../packages/core/src/sql/modification-sql-builder';
import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';
import type { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import {
    User,
    createUserMetadata,
} from './modification-sql-builder-support';

const nonPostgresDialect: SqlDialect = {
    name: 'custom',
    quoteIdentifier: identifier => `[${identifier}]`,
    quoteQualifiedIdentifier: (...identifiers) => identifiers
        .filter(Boolean)
        .map(identifier => `[${String(identifier)}]`)
        .join('.'),
    parameter: () => '?',
    countAllExpression: () => 'count(*)',
    falsePredicate: () => '0 = 1',
    insertConflictDoNothingClause: () => 'on conflict do nothing',
};

class CompositeUpsertRow {
    public partition = '';
    public sequence = 0;
    public label = '';
}

function compositeMetadata(): EntityMetadata<CompositeUpsertRow> {
    const model = new ModelBuilderImplementation();
    model.entity(CompositeUpsertRow, entity => {
        entity.toTable('composite_upsert_rows');
        entity.hasKey(row => [row.partition, row.sequence]);
        entity.property(row => row.partition).hasColumnType('text').isRequired();
        entity.property(row => row.sequence).hasColumnType('integer').isRequired();
        entity.property(row => row.label).hasColumnType('text').isRequired();
    });
    return model.build().getEntity(CompositeUpsertRow);
}

describe('ModificationSqlBuilder mutations', () => {
    it('compiles Postgres upsert SQL with a primary-key conflict by default', () => {
        const createdAt = new Date('2026-01-01T00:00:00.000Z');
        const user = new User({ id: 'usr_1', email: 'a@example.com', name: 'A', createdAt });

        expect(new ModificationSqlBuilder().buildPostgresUpsert(createUserMetadata(), user)).toEqual({
            text: 'insert into "users" ("id", "email", "display_name", "created_at") values ($1, $2, $3, $4) on conflict ("id") do update set "email" = excluded."email", "display_name" = excluded."display_name", "created_at" = excluded."created_at"',
            values: ['usr_1', 'a@example.com', 'A', createdAt],
        });
    });

    it('compiles Postgres upsert SQL with selected conflict and update properties', () => {
        const createdAt = new Date('2026-01-01T00:00:00.000Z');
        const user = new User({ id: 'usr_1', email: 'a@example.com', name: 'A', createdAt });

        expect(new ModificationSqlBuilder().buildPostgresUpsert(createUserMetadata(), user, {
            conflictProperties: ['email'],
            updateProperties: ['name', 'createdAt'],
        })).toEqual({
            text: 'insert into "users" ("id", "email", "display_name", "created_at") values ($1, $2, $3, $4) on conflict ("email") do update set "display_name" = excluded."display_name", "created_at" = excluded."created_at"',
            values: ['usr_1', 'a@example.com', 'A', createdAt],
        });
    });

    it('uses every composite key property as the default conflict target', () => {
        const row = Object.assign(new CompositeUpsertRow(), {
            partition: 'north',
            sequence: 7,
            label: 'seven',
        });

        expect(new ModificationSqlBuilder().buildPostgresUpsert(
            compositeMetadata(),
            row,
        )).toEqual({
            text: 'insert into "composite_upsert_rows" ("partition", "sequence", "label") values ($1, $2, $3) ' +
                'on conflict ("partition", "sequence") do update set "label" = excluded."label"',
            values: ['north', 7, 'seven'],
        });
    });

    it('compiles Postgres set-based update SQL with mapped predicates', () => {
        const user = createQueryProxy<User>();

        expect(new ModificationSqlBuilder().buildPostgresUpdate(createUserMetadata(), {
            values: { name: 'Updated' },
            predicate: user.email.endsWith('@example.com')
                .and(user.createdAt.gte(new Date('2026-01-01T00:00:00.000Z'))).node,
        })).toEqual({
            text: 'update "users" set "display_name" = $1 where ("email" like $2 escape \'~\' and "created_at" >= $3)',
            values: ['Updated', '%@example.com', new Date('2026-01-01T00:00:00.000Z')],
        });
    });

    it('compiles Postgres set-based delete SQL with mapped predicates', () => {
        const user = createQueryProxy<User>();

        expect(new ModificationSqlBuilder().buildPostgresDelete(createUserMetadata(), {
            predicate: user.email.eq('old@example.com').or(user.id.in(['usr_1', 'usr_2'])).node,
        })).toEqual({
            text: 'delete from "users" where ("email" = $1 or "id" in ($2, $3))',
            values: ['old@example.com', 'usr_1', 'usr_2'],
        });
    });

    it('compiles update SQL for changed non-key columns only', () => {
        const createdAt = new Date('2026-01-01T00:00:00.000Z');
        const user = new User({ id: 'usr_1', email: 'a@example.com', name: 'B', createdAt });

        expect(new ModificationSqlBuilder()
            .buildUpdate(createUserMetadata(), user, ['id', 'name'])).toEqual({
            text: 'update "users" set "display_name" = $1 where "id" = $2',
            values: ['B', 'usr_1'],
        });
    });

    it('returns undefined for key-only updates', () => {
        const createdAt = new Date('2026-01-01T00:00:00.000Z');
        const user = new User({ id: 'usr_1', email: 'a@example.com', name: 'A', createdAt });

        expect(new ModificationSqlBuilder()
            .buildUpdate(createUserMetadata(), user, ['id'])).toBeUndefined();
    });

    it('compiles delete SQL by key', () => {
        const user = new User({ id: 'usr_1' });

        expect(new ModificationSqlBuilder().buildDelete(createUserMetadata(), user)).toEqual({
            text: 'delete from "users" where "id" = $1',
            values: ['usr_1'],
        });
    });

    it('validates required values before insert and update', () => {
        const user = new User({ id: 'usr_1', email: 'a@example.com' });
        const builder = new ModificationSqlBuilder();

        expect(() => builder.buildInsert(createUserMetadata(), user))
            .toThrow('Required property \'User.name\' must have a value');
        expect(() => builder.buildUpdate(createUserMetadata(), user, ['email']))
            .toThrow('Required property \'User.name\' must have a value');
        expect(() => builder.buildPostgresUpsert(createUserMetadata(), user))
            .toThrow('Required property \'User.name\' must have a value');
    });

    it('validates Postgres upsert option shapes', () => {
        const createdAt = new Date('2026-01-01T00:00:00.000Z');
        const user = new User({ id: 'usr_1', email: 'a@example.com', name: 'A', createdAt });
        const metadata = createUserMetadata();

        expect(() => new ModificationSqlBuilder(nonPostgresDialect)
            .buildPostgresUpsert(metadata, user))
            .toThrow('Postgres upsert statements require the postgres SQL dialect.');
        expect(() => new ModificationSqlBuilder()
            .buildPostgresUpsert(metadata, user, { conflictProperties: [] }))
            .toThrow('Postgres upsert conflictProperties must select at least one property.');
        expect(() => new ModificationSqlBuilder()
            .buildPostgresUpsert(metadata, user, { updateProperties: ['name', 'name'] }))
            .toThrow('Postgres upsert updateProperties contains duplicate property \'User.name\'.');
        expect(() => new ModificationSqlBuilder().buildPostgresUpsert(metadata, user, {
            conflictProperties: ['email'],
            updateProperties: ['email'],
        })).toThrow('Postgres upsert updateProperties cannot include conflict property \'User.email\'.');
    });

    it('validates Postgres set-based update and delete option shapes', () => {
        const metadata = createUserMetadata();
        const user = createQueryProxy<User>();

        expect(() => new ModificationSqlBuilder(nonPostgresDialect).buildPostgresUpdate(metadata, {
            values: { name: 'Updated' },
            predicate: user.email.eq('a@example.com').node,
        })).toThrow('Postgres update statements require the postgres SQL dialect.');
        expect(() => new ModificationSqlBuilder(nonPostgresDialect).buildPostgresDelete(metadata, {
            predicate: user.email.eq('a@example.com').node,
        })).toThrow('Postgres delete statements require the postgres SQL dialect.');
        expect(() => new ModificationSqlBuilder().buildPostgresUpdate(metadata, {
            values: {},
            predicate: user.email.eq('a@example.com').node,
        })).toThrow('Postgres update statements must set at least one property.');
        expect(() => new ModificationSqlBuilder().buildPostgresUpdate(metadata, {
            values: { id: 'usr_2' },
            predicate: user.email.eq('a@example.com').node,
        })).toThrow('Postgres update statements cannot update primary key property \'User.id\'.');
        expect(() => new ModificationSqlBuilder().buildPostgresUpdate(metadata, {
            values: { name: 'Updated' },
            predicate: undefined as never,
        })).toThrow('Postgres update statements require a where predicate.');
        expect(() => new ModificationSqlBuilder().buildPostgresDelete(metadata, {
            predicate: undefined as never,
        })).toThrow('Postgres delete statements require a where predicate.');
    });
});

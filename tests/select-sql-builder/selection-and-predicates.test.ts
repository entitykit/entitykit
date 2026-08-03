import { ModelBuilder as ModelBuilderImplementation } from '../../src/model/model-builder';
import { type SqlStatement } from '../../src';
import { createQueryModel, createQueryProxy } from '../../src/experimental';
import { SelectSqlBuilder } from '../../src/sql/select-sql-builder';
import { User, createUserMetadata } from './support';

describe('SelectSqlBuilder selection and predicates', () => {
    it('compiles parameterized select SQL', () => {
        const metadata = createUserMetadata();
        const u = createQueryProxy<User>();
        const query = {
            ...createQueryModel(User),
            predicate: u.email.eq('a@example.com').and(u.name.like('A%')),
            orderings: [u.createdAt.desc()],
            limit: 10,
            offset: 20,
        };

        const statement = new SelectSqlBuilder().build(metadata, query);

        expect(statement).toEqual({
            text: 'select "id", "email", "display_name", "created_at", "deleted_at" from "users" where ("email" = $1 and "display_name" like $2) order by "created_at" desc limit $3 offset $4',
            values: ['a@example.com', 'A%', 10, 20],
        });
    });

    it('escapes %, _, and the escape char in contains/startsWith/endsWith so they match literally', () => {
        const metadata = createUserMetadata();
        const u = createQueryProxy<User>();
        const build = (predicate: ReturnType<typeof u.name.contains>): SqlStatement =>
            new SelectSqlBuilder().build(metadata, { ...createQueryModel(User), predicate });

        // `~` escapes the two LIKE wildcards; the outer `%` (the contains wrapper)
        // stay live. The `escape '~'` clause makes the escaped pattern literal.
        const contains = build(u.name.contains('50%_off'));
        expect(contains.text).toContain('"display_name" like $1 escape \'~\'');
        expect(contains.values).toEqual(['%50~%~_off%']);

        expect(build(u.name.startsWith('a_')).values).toEqual(['a~_%']);
        expect(build(u.name.endsWith('~x')).values).toEqual(['%~~x']); // literal ~ is doubled

        // Raw `like()` is the escape hatch: the caller owns the wildcards, so no
        // escaping and no escape clause.
        const raw = build(u.name.like('A%_'));
        expect(raw.text).toContain('"display_name" like $1');
        expect(raw.text).not.toContain('escape');
        expect(raw.values).toEqual(['A%_']);
    });

    it('compiles in, explicit null, and not predicates', () => {
        const metadata = createUserMetadata();
        const u = createQueryProxy<User>();
        const query = {
            ...createQueryModel(User),
            predicate: u.id.in(['usr_1', 'usr_2']).and(u.email.isNotNull()).and(u.name.eq('A').not()),
        };

        const statement = new SelectSqlBuilder().build(metadata, query);

        expect(statement.text).toBe('select "id", "email", "display_name", "created_at", "deleted_at" from "users" where (("id" in ($1, $2) and "email" is not null) and (not "display_name" = $3))');
        expect(statement.values).toEqual(['usr_1', 'usr_2', 'A']);
    });

    it('compiles null equality and inequality without parameters', () => {
        const metadata = createUserMetadata();
        const u = createQueryProxy<User>();
        const query = {
            ...createQueryModel(User),
            predicate: u.deletedAt.eq(null).or(u.deletedAt.ne(undefined as never)),
        };

        const statement = new SelectSqlBuilder().build(metadata, query);

        expect(statement).toEqual({
            text: 'select "id", "email", "display_name", "created_at", "deleted_at" from "users" where ("deleted_at" is null or "deleted_at" is not null)',
            values: [],
        });
    });

    it('compiles null-aware membership without binding SQL null', () => {
        const metadata = createUserMetadata();
        const u = createQueryProxy<User>();
        const deletedAt = new Date('2026-01-01T00:00:00.000Z');
        const build = (values: ReadonlyArray<Date | null>): SqlStatement =>
            new SelectSqlBuilder().build(metadata, {
                ...createQueryModel(User),
                predicate: u.deletedAt.in(values),
            });

        expect(build([deletedAt, null])).toEqual({
            text: 'select "id", "email", "display_name", "created_at", "deleted_at" from "users" where ("deleted_at" in ($1) or "deleted_at" is null)',
            values: [deletedAt],
        });
        expect(build([null])).toEqual({
            text: 'select "id", "email", "display_name", "created_at", "deleted_at" from "users" where "deleted_at" is null',
            values: [],
        });
    });

    it('compiles empty in lists to a false predicate', () => {
        const metadata = createUserMetadata();
        const u = createQueryProxy<User>();
        const query = {
            ...createQueryModel(User),
            predicate: u.id.in([]),
        };

        const statement = new SelectSqlBuilder().build(metadata, query);

        expect(statement.text).toContain('where 1 = 0');
        expect(statement.values).toEqual([]);
    });

    it('compiles count and exists SQL', () => {
        const metadata = createUserMetadata();
        const u = createQueryProxy<User>();
        const query = {
            ...createQueryModel(User),
            predicate: u.email.like('%@example.com'),
        };

        expect(new SelectSqlBuilder().buildCount(metadata, query)).toEqual({
            text: 'select count(*) as "count" from "users" where "email" like $1',
            values: ['%@example.com'],
        });
        expect(new SelectSqlBuilder().buildExists(metadata, query)).toEqual({
            text: 'select exists(select 1 from "users" where "email" like $1 limit 1) as "exists"',
            values: ['%@example.com'],
        });
    });

    it('quotes SQL identifiers', () => {
        const model = new ModelBuilderImplementation();
        model.entity(User, entity => {
            entity.toTable('odd"users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('odd"id').hasColumnType('text').isRequired();
        });

        const statement = new SelectSqlBuilder().build(model.build().getEntity(User), createQueryModel(User));

        expect(statement.text).toBe('select "odd""id" from "odd""users"');
    });
});

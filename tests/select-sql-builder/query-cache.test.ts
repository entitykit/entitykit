import { requireDefined } from '../support/require-defined';
import type { SqlDialect } from '../../src/adapter';
import {
    createProjectionBuilder,
    createProjectionExpression,
    createProjectionProxy,
    createQueryModel,
    createQueryProxy,
} from '../../src/experimental';
import { SelectSqlBuilder } from '../../src/sql/select-sql-builder';
import { User, createUserMetadata } from './support';

describe('SelectSqlBuilder query cache', () => {
    it('reuses cached SQL text while rebinding runtime values', () => {
        const metadata = createUserMetadata();
        const u = createQueryProxy<User>();
        const builder = new SelectSqlBuilder();

        const first = builder.build(metadata, {
            ...createQueryModel(User),
            predicate: u.email.contains('alpha').and(u.name.startsWith('A')),
            orderings: [u.createdAt.desc()],
            limit: 10,
            offset: 20,
        });
        const second = builder.build(metadata, {
            ...createQueryModel(User),
            predicate: u.email.contains('beta').and(u.name.startsWith('B')),
            orderings: [u.createdAt.desc()],
            limit: 30,
            offset: 40,
        });

        expect(second.text).toBe(first.text);
        expect(second.values).toEqual(['%beta%', 'B%', 30, 40]);
    });

    it('rebinds literals nested inside computed projections', () => {
        const metadata = createUserMetadata();
        const u = createQueryProxy<User>();
        const builder = new SelectSqlBuilder();
        const projection = (
            suffix: string,
            increment: number,
        ): ReturnType<typeof createProjectionExpression> => {
            const sql = createProjectionBuilder();
            const fields = createProjectionProxy<User>();
            return createProjectionExpression({
                label: sql.concat(
                    fields.name,
                    sql.literal(suffix),
                ),
                next: sql.add(
                    sql.literal(increment),
                    sql.literal(1),
                ),
            });
        };

        const first = builder.build(metadata, {
            ...createQueryModel(User),
            projection: projection('!', 1),
            predicate: u.email.eq('first@example.com'),
        });
        const second = builder.build(metadata, {
            ...createQueryModel(User),
            projection: projection('?', 5),
            predicate: u.email.eq('second@example.com'),
        });

        expect(second.text).toBe(first.text);
        expect(second.values).toEqual([
            '?',
            5,
            1,
            'second@example.com',
        ]);
    });

    it('rejects Promise values recovered for cached predicates', async () => {
        const metadata = createUserMetadata();
        const user = createQueryProxy<User>();
        const builder = new SelectSqlBuilder();
        builder.build(metadata, {
            ...createQueryModel(User),
            predicate: user.email.eq('first@example.com'),
        });
        const unhandled: unknown[] = [];
        const observeUnhandled = (reason: unknown): void => {
            unhandled.push(reason);
        };
        process.on('unhandledRejection', observeUnhandled);
        try {
            const rejected = Promise.reject(new Error('forgot await'));
            expect(() => builder.build(metadata, {
                ...createQueryModel(User),
                predicate: user.email.eq(rejected as never),
            })).toThrow('SQL parameters cannot be Promises');
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(unhandled).toEqual([]);
        } finally {
            process.off('unhandledRejection', observeUnhandled);
        }
    });

    it('rejects invalid Dates recovered for cached predicates', () => {
        const metadata = createUserMetadata();
        const user = createQueryProxy<User>();
        const builder = new SelectSqlBuilder();
        builder.build(metadata, {
            ...createQueryModel(User),
            predicate: user.createdAt.eq(new Date('2026-01-01T00:00:00.000Z')),
        });

        expect(() => builder.build(metadata, {
            ...createQueryModel(User),
            predicate: user.createdAt.eq(new Date(Number.NaN)),
        })).toThrow('Invalid Date at \'User.createdAt\'');
    });

    it('validates cached literal and coalesce projection values', () => {
        const metadata = createUserMetadata();
        const builder = new SelectSqlBuilder();
        const projection = (value: unknown): ReturnType<typeof createProjectionExpression> => {
            const sql = createProjectionBuilder();
            const fields = createProjectionProxy<User>();
            return createProjectionExpression({
                literal: sql.literal(value as string),
                fallback: sql.coalesce(
                    fields.name,
                    sql.literal(value as string),
                ),
            });
        };
        builder.build(metadata, {
            ...createQueryModel(User),
            projection: projection('valid'),
        });

        expect(() => builder.build(metadata, {
            ...createQueryModel(User),
            projection: projection(Promise.resolve('invalid')),
        })).toThrow('SQL parameters cannot be Promises');
        expect(() => builder.build(metadata, {
            ...createQueryModel(User),
            projection: projection(new Date(Number.NaN)),
        })).toThrow('SQL parameters cannot contain an invalid Date');
    });

    it('keeps in-list cardinality in the cache key because SQL text changes', () => {
        const metadata = createUserMetadata();
        const u = createQueryProxy<User>();
        const builder = new SelectSqlBuilder();

        const twoItems = builder.build(metadata, {
            ...createQueryModel(User),
            predicate: u.id.in(['usr_1', 'usr_2']),
        });
        const threeItems = builder.build(metadata, {
            ...createQueryModel(User),
            predicate: u.id.in(['usr_3', 'usr_4', 'usr_5']),
        });

        expect(twoItems.text).toContain('in ($1, $2)');
        expect(twoItems.values).toEqual(['usr_1', 'usr_2']);
        expect(threeItems.text).toContain('in ($1, $2, $3)');
        expect(threeItems.values).toEqual(['usr_3', 'usr_4', 'usr_5']);
    });

    it('uses cached SQL without re-invoking dialect SQL rendering', () => {
        const metadata = createUserMetadata();
        const u = createQueryProxy<User>();
        let quoteCalls = 0;
        const dialect: SqlDialect = {
            name: 'cache-test',
            quoteIdentifier(identifier: string): string {
                quoteCalls += 1;
                return `[${identifier}]`;
            },
            quoteQualifiedIdentifier(...identifiers: ReadonlyArray<string | undefined>): string {
                return identifiers.filter(Boolean).map(identifier => this.quoteIdentifier(requireDefined(identifier))).join('.');
            },
            parameter(index: number): string {
                return `@p${String(index)}`;
            },
            countAllExpression(): string {
                return 'count_big(*)';
            },
            falsePredicate(): string {
                return '0 = 1';
            },
            insertConflictDoNothingClause(): string {
                return 'on conflict do nothing';
            },
        };
        const builder = new SelectSqlBuilder(dialect);
        const first = builder.build(metadata, {
            ...createQueryModel(User),
            predicate: u.email.eq('a@example.com'),
            limit: 1,
        });
        quoteCalls = 0;

        const second = builder.build(metadata, {
            ...createQueryModel(User),
            predicate: u.email.eq('b@example.com'),
            limit: 2,
        });

        expect(first.text).toBe('select [id], [email], [display_name], [created_at], [deleted_at] from [users] where [email] = @p1 limit @p2');
        expect(second).toEqual({
            text: first.text,
            values: ['b@example.com', 2],
        });
        expect(quoteCalls).toBe(0);
    });

    it('keeps null equality distinct from scalar equality in cached SQL', () => {
        const metadata = createUserMetadata();
        const u = createQueryProxy<User>();
        const builder = new SelectSqlBuilder();

        const scalar = builder.build(metadata, {
            ...createQueryModel(User),
            predicate: u.deletedAt.eq(new Date('2026-01-01T00:00:00.000Z')),
        });
        const nullCheck = builder.build(metadata, {
            ...createQueryModel(User),
            predicate: u.deletedAt.eq(null),
        });

        expect(scalar).toEqual({
            text: 'select "id", "email", "display_name", "created_at", "deleted_at" from "users" where "deleted_at" = $1',
            values: [new Date('2026-01-01T00:00:00.000Z')],
        });
        expect(nullCheck).toEqual({
            text: 'select "id", "email", "display_name", "created_at", "deleted_at" from "users" where "deleted_at" is null',
            values: [],
        });
    });

    it('keeps null presence in membership cache keys and rebinds only values', () => {
        const metadata = createUserMetadata();
        const u = createQueryProxy<User>();
        const builder = new SelectSqlBuilder();
        const first = new Date('2026-01-01T00:00:00.000Z');
        const second = new Date('2026-02-01T00:00:00.000Z');

        const nonNull = builder.build(metadata, {
            ...createQueryModel(User),
            predicate: u.deletedAt.in([first, second]),
        });
        const mixed = builder.build(metadata, {
            ...createQueryModel(User),
            predicate: u.deletedAt.in([first, null]),
        });
        const mixedCacheHit = builder.build(metadata, {
            ...createQueryModel(User),
            predicate: u.deletedAt.in([second, undefined as never]),
        });

        expect(nonNull.text).toContain('"deleted_at" in ($1, $2)');
        expect(mixed.text).toContain('("deleted_at" in ($1) or "deleted_at" is null)');
        expect(mixedCacheHit).toEqual({
            text: mixed.text,
            values: [second],
        });
    });
});

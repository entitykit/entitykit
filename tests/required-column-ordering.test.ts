import { DatabaseSync } from 'node:sqlite';
import { ModelBuilder } from '../packages/core/src/model/model-builder';
import type { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import { createQueryModel, createQueryProxy } from '../packages/core/src/experimental';
import { SelectSqlBuilder, buildSelectSqlCacheKey } from '../packages/core/src/sql/select-sql-builder';
import { sqliteDialect } from '../packages/sqlite/src/sqlite-dialect';
import { mySqlDialect } from '../packages/mysql/src/mysql-dialect';
import { postgresDialect } from '../packages/core/src/sql/postgres-dialect';
import { AppDbContext, createDb } from './joined-projection/support';

class OrderedRow {
    public id = 0;
    public tenantId = 0;
    public score: number | null = 0;
    public label: string | null = null;
}

function metadata(required = true): EntityMetadata<OrderedRow> {
    return new ModelBuilder().entity(OrderedRow, entity => {
        entity.toTable('ordered_rows');
        entity.hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('integer').isRequired();
        entity.property(row => row.tenantId).hasColumnType('integer').isRequired();
        const score = entity.property(row => row.score).hasColumnType('integer');
        if (required) score.isRequired();
        entity.property(row => row.label).hasColumnType('text');
    }).build().getEntity(OrderedRow);
}

const row = createQueryProxy<OrderedRow>();

describe('required root-column ordering', () => {
    afterEach(() => {
        AppDbContext.dialect = undefined;
        jest.restoreAllMocks();
    });

    it.each([sqliteDialect, mySqlDialect, postgresDialect])('omits null handling for required columns on $name', dialect => {
        const statement = new SelectSqlBuilder(dialect).build(metadata(), {
            ...createQueryModel(OrderedRow),
            orderings: [row.score.asc(), row.id.desc()],
        });
        const quote = (name: string): string => dialect.quoteIdentifier(name);
        expect(statement.text).toContain(`order by ${quote('score')} asc, ${quote('id')} desc`);
        expect(statement.text).not.toMatch(/nulls|is null/iu);
    });

    it.each([sqliteDialect, mySqlDialect])('keeps nullable ordering with required tie breakers on $name', dialect => {
        const builder = new SelectSqlBuilder(dialect);
        for (const direction of ['asc', 'desc'] as const) {
            const statement = builder.build(metadata(), {
                ...createQueryModel(OrderedRow),
                orderings: [{ propertyName: 'label', direction }, row.id.asc()],
            });
            const label = dialect.quoteIdentifier('label');
            const nullable = `${dialect.nullOrderingPrefix?.(label, direction) ?? ''}${label} ${direction}${dialect.nullOrderingClause?.(direction) ?? ''}`;
            expect(statement.text.endsWith(`order by ${nullable}, ${dialect.quoteIdentifier('id')} asc`)).toBe(true);
        }
    });

    it('keeps required-column SQL distinct from nullable-column SQL in the shared cache', () => {
        const builder = new SelectSqlBuilder(sqliteDialect);
        const query = { ...createQueryModel(OrderedRow), orderings: [row.score.asc()], limit: 3 };
        const required = metadata();
        const nullable = metadata(false);
        expect(buildSelectSqlCacheKey(required, query, sqliteDialect))
            .not.toBe(buildSelectSqlCacheKey(nullable, query, sqliteDialect));
        expect(builder.build(required, query).text).toContain('order by "score" asc limit ?');
        expect(builder.build(nullable, query).text).toContain('order by "score" asc nulls last limit ?');
        const rebound = builder.build(required, { ...query, limit: 7 });
        expect(rebound.text).toContain('order by "score" asc limit ?');
        expect(rebound.values).toEqual([7]);
    });

    it('observes a changed column nullability before reusing SQL', () => {
        const model = metadata();
        const builder = new SelectSqlBuilder(sqliteDialect);
        const query = { ...createQueryModel(OrderedRow), orderings: [row.score.desc()] };
        expect(builder.build(model, query).text.endsWith('order by "score" desc')).toBe(true);
        Object.defineProperty(model.getProperty('score'), 'isRequired', { value: false });
        expect(builder.build(model, query).text).toContain('order by "score" desc nulls first');
    });

    it('does not infer joined ordering nullability from the root metadata', () => {
        const model = metadata();
        const joined = metadata() as unknown as EntityMetadata;
        jest.spyOn(model, 'getProperty').mockImplementation(() => {
            throw new Error('Joined ordering cannot read the root property');
        });
        const key = buildSelectSqlCacheKey(model, {
            ...createQueryModel(OrderedRow),
            joins: [{ alias: 'other', metadata: joined, kind: 'left', predicate: row.id.eq(1) }],
            orderings: [{ propertyName: 'label', sourceAlias: 'other', direction: 'asc' }],
        }, sqliteDialect);
        expect(key).not.toContain('isRequired');
    });

    it('preserves null placement on the optional side of a left join despite required mapping', async () => {
        const db = createDb(undefined, sqliteDialect);
        try {
            const statement = db.posts
                .leftJoin('author', db.authors, ({ root, author }) => root.authorId.eq(author.id))
                .orderBy(({ author }) => author.email)
                .select(({ root, author }) => ({ id: root.id, email: author.email }))
                .toSql();
            expect(statement.text).toContain('order by "author"."email" asc nulls last');
        } finally {
            await db.dispose();
        }
    });

    it('retains ascending and descending nullable-row order in SQLite', () => {
        const db = new DatabaseSync(':memory:');
        try {
            db.exec('create table ordered_rows (id integer primary key not null, tenantId integer not null, score integer not null, label text)');
            db.exec('insert into ordered_rows values (1,1,1,null),(2,1,1,\'b\'),(3,1,1,\'a\')');
            const builder = new SelectSqlBuilder(sqliteDialect);
            for (const [direction, expected] of [['asc', [3, 2, 1]], ['desc', [1, 2, 3]]] as const) {
                const statement = builder.build(metadata(), {
                    ...createQueryModel(OrderedRow),
                    orderings: [{ propertyName: 'label', direction }, row.id.asc()],
                });
                expect(db.prepare(statement.text).all().map(value => value.id)).toEqual(expected);
            }
        } finally {
            db.close();
        }
    });

    it('uses the composite SQLite index without a temporary required-key sort', () => {
        const db = new DatabaseSync(':memory:');
        try {
            db.exec('create table ordered_rows (id integer primary key not null, tenantId integer not null, score integer not null, label text)');
            db.exec('create index ordered_tenant_score_id on ordered_rows(tenantId,score,id)');
            const insert = db.prepare('insert into ordered_rows values (?,?,?,?)');
            const values = Array.from({ length: 500 }, (_, index) => ({
                id: index + 1, tenantId: index % 2, score: index % 4, label: String(index),
            }));
            for (const value of values) insert.run(value.id, value.tenantId, value.score, value.label);
            db.exec('analyze');
            const statement = new SelectSqlBuilder(sqliteDialect).build(metadata(), {
                ...createQueryModel(OrderedRow),
                predicate: row.tenantId.eq(1).and(row.score.gte(1)),
                orderings: [row.score.asc(), row.id.asc()],
                limit: 50,
            });
            expect(statement.values).toEqual([1, 1, 50]);
            const expected = values.filter(value => value.tenantId === 1 && value.score >= 1)
                .sort((a, b) => a.score - b.score || a.id - b.id).slice(0, 50);
            expect(db.prepare(statement.text).all(1, 1, 50).map(value => ({ ...value }))).toEqual(expected);
            const plan = db.prepare(`explain query plan ${statement.text}`).all(1, 1, 50);
            expect(plan.some(value => String(value.detail).includes('ordered_tenant_score_id'))).toBe(true);
            expect(plan.some(value => /temp b-tree/iu.test(String(value.detail)))).toBe(false);
        } finally {
            db.close();
        }
    });
});

import type { SqlDialect } from '../../src/adapter';
import { Queryable } from '../../src/experimental';
import { SelectSqlBuilder } from '../../src/sql/select-sql-builder';
import { mySqlDialect } from '../../src/providers/mysql/mysql-dialect';
import { sqliteDialect } from '../../src/providers/sqlite/sqlite-dialect';
import { RecordingDatabaseConnection } from '../support/recording-database-connection';
import { createDb, createOrderMetadata, RecordingExecutor } from './support';

describe('aggregate SQL generation', () => {
    it('renders ungrouped aggregate projection SQL with filters', () => {
        const db =  createDb();
        const start = new Date('2026-01-01T00:00:00.000Z');

        expect(db.orders
            .where(order => order.createdAt.gte(start))
            .aggregate(agg => ({
                orderCount: agg.count(),
                paidOrderCount: agg.count(order => order.paidAt),
                totalCents: agg.sum(order => order.totalCents),
                averageCents: agg.avg(order => order.totalCents),
                latestOrderAt: agg.max(order => order.createdAt),
                firstEmail: agg.min(order => order.customerEmail),
            }))
            .toSql()).toEqual({
            text: 'select count(*)::int as "orderCount", count("paid_at") as "paidOrderCount", sum("total_cents") as "totalCents", avg("total_cents") as "averageCents", max("created_at") as "latestOrderAt", min("customer_email") as "firstEmail" from "orders" where (("created_at" >= $1 and "archived_at" is null) and "workspace_id" = $2)',
            values: [start, 'wrk_1'],
        });
    });

    it('renders grouped aggregate projection SQL with filters', () => {
        const db =  createDb();
        const start = new Date('2026-01-01T00:00:00.000Z');

        expect(db.orders
            .where(order => order.createdAt.gte(start))
            .groupBy(order => ({
                workspaceId: order.workspaceId,
                customerEmail: order.customerEmail,
            }))
            .select(group => ({
                workspaceId: group.key.workspaceId,
                customerEmail: group.key.customerEmail,
                orderCount: group.count(),
                totalCents: group.sum(order => order.totalCents),
                latestOrderAt: group.max(order => order.createdAt),
            }))
            .toSql()).toEqual({
            text: 'select "workspace_id" as "workspaceId", "customer_email" as "customerEmail", count(*)::int as "orderCount", sum("total_cents") as "totalCents", max("created_at") as "latestOrderAt" from "orders" where (("created_at" >= $1 and "archived_at" is null) and "workspace_id" = $2) group by "workspace_id", "customer_email"',
            values: [start, 'wrk_1'],
        });
    });

    it('renders grouped aggregate having SQL after group by with deterministic parameters', () => {
        const db =  createDb();
        const start = new Date('2026-01-01T00:00:00.000Z');

        expect(db.orders
            .where(order => order.createdAt.gte(start))
            .groupBy(order => ({ customerEmail: order.customerEmail }))
            .having(group => group.count().gte(2).and(group.key.customerEmail.contains('@example.com')))
            .select(group => ({
                customerEmail: group.key.customerEmail,
                orderCount: group.count(),
                totalCents: group.sum(order => order.totalCents),
            }))
            .toSql()).toEqual({
            text: 'select "customer_email" as "customerEmail", count(*)::int as "orderCount", sum("total_cents") as "totalCents" from "orders" where (("created_at" >= $1 and "archived_at" is null) and "workspace_id" = $2) group by "customer_email" having (count(*)::int >= $3 and "customer_email" like $4 escape \'~\')',
            values: [start, 'wrk_1', 2, '%@example.com%'],
        });
    });

    it('renders null-aware membership in having predicates', () => {
        const db =  createDb();
        const paidAt = new Date('2026-01-01T00:00:00.000Z');

        const statement = db.orders
            .groupBy(order => ({ paidAt: order.paidAt }))
            .having(group => group.key.paidAt.in([paidAt, null]))
            .select(group => ({
                paidAt: group.key.paidAt,
                orderCount: group.count(),
            }))
            .toSql();

        expect(statement.text).toContain(
            'having ("paid_at" in ($2) or "paid_at" is null)',
        );
        expect(statement.values).toEqual(['wrk_1', paidAt]);
    });

    it('renders grouped aggregate ordering and paging SQL after having', () => {
        const db =  createDb();
        const start = new Date('2026-01-01T00:00:00.000Z');

        expect(db.orders
            .where(order => order.createdAt.gte(start))
            .groupBy(order => ({ customerEmail: order.customerEmail }))
            .having(group => group.count().gte(2))
            .orderByDescending(group => group.count())
            .orderBy(group => group.key.customerEmail.asc())
            .skip(10)
            .take(5)
            .select(group => ({
                customerEmail: group.key.customerEmail,
                orderCount: group.count(),
                totalCents: group.sum(order => order.totalCents),
            }))
            .toSql()).toEqual({
            text: 'select "customer_email" as "customerEmail", count(*)::int as "orderCount", sum("total_cents") as "totalCents" from "orders" where (("created_at" >= $1 and "archived_at" is null) and "workspace_id" = $2) group by "customer_email" having count(*)::int >= $3 order by count(*)::int desc, "customer_email" asc limit $4 offset $5',
            values: [start, 'wrk_1', 2, 5, 10],
        });
    });

    it('places nulls SQL-standard in a grouped aggregate order-by for SQLite', () => {
        const db =  createDb(new RecordingDatabaseConnection(), sqliteDialect);

        // Ordering a grouped result by a group key can surface a null-keyed group;
        // SQLite sorts nulls low by default, so the aggregate order-by must state
        // `nulls last`, matching the row path, a top-level orderBy, and Postgres.
        const sql = db.orders
            .groupBy(order => ({ customerEmail: order.customerEmail }))
            .orderBy(group => group.key.customerEmail.asc())
            .select(group => ({ customerEmail: group.key.customerEmail, orderCount: group.count() }))
            .toSql();

        expect(sql.text).toContain('order by "customer_email" asc nulls last');
    });

    it('places nulls SQL-standard in a grouped aggregate order-by for MySQL', () => {
        const db =  createDb(new RecordingDatabaseConnection(), mySqlDialect);

        // MySQL has no `NULLS` keyword; the leading `(col is null)` term keeps the
        // descending null group first (SQL-standard).
        const sql = db.orders
            .groupBy(order => ({ customerEmail: order.customerEmail }))
            .orderByDescending(group => group.key.customerEmail)
            .select(group => ({ customerEmail: group.key.customerEmail, orderCount: group.count() }))
            .toSql();

        expect(sql.text).toContain('order by `customer_email` is null desc, `customer_email` desc');
    });

    it('casts the avg operand to double on MySQL so a grouped average keeps full precision', () => {
        const db =  createDb(new RecordingDatabaseConnection(), mySqlDialect);

        // MySQL's grouped AVG truncates to a few decimals; averaging the column cast
        // to double keeps full precision, matching Postgres and SQLite. Only avg
        // needs it — sum stays exact.
        const sql = db.orders
            .groupBy(order => ({ email: order.customerEmail }))
            .select(group => ({ email: group.key.email, average: group.avg(order => order.totalCents), total: group.sum(order => order.totalCents) }))
            .toSql();

        expect(sql.text).toContain('avg(cast(`total_cents` as double))');
        expect(sql.text).toContain('sum(`total_cents`)'); // sum is unchanged
    });

    it('averages the column directly on Postgres and SQLite', () => {
        const db =  createDb(); // default Postgres dialect

        const sql = db.orders
            .groupBy(order => ({ email: order.customerEmail }))
            .select(group => ({ email: group.key.email, average: group.avg(order => order.totalCents) }))
            .toSql();

        expect(sql.text).toContain('avg("total_cents")');
        expect(sql.text).not.toContain('cast');
    });

    it('uses the configured SQL dialect for aggregate previews', () => {
        const dialect: SqlDialect = {
            name: 'aggregate-test',
            quoteIdentifier: identifier => `[${identifier}]`,
            quoteQualifiedIdentifier: (...identifiers) => identifiers.filter(Boolean).map(identifier => `[${String(identifier)}]`).join('.'),
            parameter: () => '?',
            countAllExpression: () => 'count(*)',
            falsePredicate: () => '0 = 1',
            insertConflictDoNothingClause: () => 'on conflict do nothing',
        };
        const db =  createDb(new RecordingDatabaseConnection(), dialect);

        expect(db.orders
            .where(order => order.customerEmail.contains('@example.com'))
            .aggregate(agg => ({
                orderCount: agg.count(),
                totalCents: agg.sum(order => order.totalCents),
            }))
            .toSql()).toEqual({
            text: 'select count(*) as [orderCount], sum([total_cents]) as [totalCents] from [orders] where (([customer_email] like ? escape \'~\' and [archived_at] is null) and [workspace_id] = ?)',
            values: ['%@example.com%', 'wrk_1'],
        });
    });

    it('rejects aggregate SQL shapes sent through the row compiler', () => {
        const metadata = createOrderMetadata();
        const orderedAggregate = new Queryable(metadata, new RecordingExecutor())
            .orderBy(order => order.createdAt)
            .aggregate(agg => ({ orderCount: agg.count() }));

        expect(() => new SelectSqlBuilder().build(metadata, orderedAggregate.toQueryModel()))
            .toThrow('Aggregate projection SQL compilation belongs to buildAggregate().');
        expect(() => new SelectSqlBuilder().buildAggregate(metadata, orderedAggregate.toQueryModel()))
            .toThrow('Aggregate projections do not support source orderings.');

        const groupedAggregate = new Queryable(metadata, new RecordingExecutor())
            .groupBy(order => ({ customerEmail: order.customerEmail }))
            .select(group => ({
                customerEmail: group.key.customerEmail,
                orderCount: group.count(),
            }));

        expect(() => new SelectSqlBuilder().build(metadata, groupedAggregate.toQueryModel()))
            .toThrow('Grouped aggregate SQL compilation belongs to buildAggregate().');

        const ungroupedPagedAggregate = {
            ...new Queryable(metadata, new RecordingExecutor())
                .aggregate(agg => ({ orderCount: agg.count() }))
                .toQueryModel(),
            limit: 5,
        };

        expect(() => new SelectSqlBuilder().buildAggregate(metadata, ungroupedPagedAggregate))
            .toThrow('Only grouped aggregate projections support ordering or paging.');
    });
});

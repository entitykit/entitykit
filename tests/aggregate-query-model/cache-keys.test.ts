import { postgres } from '../../src/providers/postgres';
import { Queryable } from '../../src/experimental';
import { buildSelectSqlCacheKey } from '../../src/sql/select-sql-builder';
import { createOrderMetadata, RecordingExecutor } from './support';

describe('aggregate query cache keys', () => {
    it('includes aggregate projection shape in select SQL cache keys', () => {
        const metadata = createOrderMetadata();
        const orders = new Queryable(metadata, new RecordingExecutor());

        const totalKey = buildSelectSqlCacheKey(metadata, orders.aggregate(agg => ({
            totalCents: agg.sum(order => order.totalCents),
        })).toQueryModel());
        const countKey = buildSelectSqlCacheKey(metadata, orders.aggregate(agg => ({
            orderCount: agg.count(),
        })).toQueryModel());

        expect(totalKey).not.toBe(countKey);
        expect(JSON.parse(totalKey)).toMatchObject({
            aggregateProjection: [{
                alias: 'totalCents',
                function: 'sum',
                propertyName: 'totalCents',
            }],
        });
    });

    it('includes grouped aggregate projection shape in select SQL cache keys', () => {
        const metadata = createOrderMetadata();
        const orders = new Queryable(metadata, new RecordingExecutor());

        const byWorkspace = buildSelectSqlCacheKey(metadata, orders
            .groupBy(order => ({ workspaceId: order.workspaceId }))
            .select(group => ({
                workspaceId: group.key.workspaceId,
                orderCount: group.count(),
            }))
            .toQueryModel());
        const byCustomer = buildSelectSqlCacheKey(metadata, orders
            .groupBy(order => ({ customerEmail: order.customerEmail }))
            .select(group => ({
                customerEmail: group.key.customerEmail,
                orderCount: group.count(),
            }))
            .toQueryModel());

        expect(byWorkspace).not.toBe(byCustomer);
        expect(JSON.parse(byWorkspace)).toMatchObject({
            groupKeys: [{
                alias: 'workspaceId',
                propertyName: 'workspaceId',
            }],
            groupKeyProjection: [{
                alias: 'workspaceId',
                keyAlias: 'workspaceId',
                propertyName: 'workspaceId',
            }],
            aggregateProjection: [{
                alias: 'orderCount',
                function: 'count',
            }],
        });
    });

    it('includes provider-owned date-bucket group key shape in select SQL cache keys', () => {
        const metadata = createOrderMetadata();
        const orders = new Queryable(metadata, new RecordingExecutor());

        const utcDay = buildSelectSqlCacheKey(metadata, orders
            .groupBy(order => ({ day: postgres.dateBucket('day', order.createdAt, { timeZone: 'UTC' }) }))
            .select(group => ({ day: group.key.day, orderCount: group.count() }))
            .toQueryModel());
        const chicagoWeek = buildSelectSqlCacheKey(metadata, orders
            .groupBy(order => ({ week: postgres.dateBucket('week', order.createdAt, { timeZone: 'America/Chicago' }) }))
            .select(group => ({ week: group.key.week, orderCount: group.count() }))
            .toQueryModel());

        expect(utcDay).not.toBe(chicagoWeek);
        expect(JSON.parse(utcDay)).toMatchObject({
            groupKeys: [{
                kind: 'dateBucket',
                provider: 'postgres',
                precision: 'day',
                timeZone: 'UTC',
                propertyName: 'createdAt',
            }],
        });
    });

    it('includes having predicate shape in select SQL cache keys', () => {
        const metadata = createOrderMetadata();
        const orders = new Queryable(metadata, new RecordingExecutor());

        const twoOrMore = buildSelectSqlCacheKey(metadata, orders
            .groupBy(order => ({ customerEmail: order.customerEmail }))
            .having(group => group.count().gte(2))
            .select(group => ({
                customerEmail: group.key.customerEmail,
                orderCount: group.count(),
            }))
            .toQueryModel());
        const fiveOrMore = buildSelectSqlCacheKey(metadata, orders
            .groupBy(order => ({ customerEmail: order.customerEmail }))
            .having(group => group.count().gte(5))
            .select(group => ({
                customerEmail: group.key.customerEmail,
                orderCount: group.count(),
            }))
            .toQueryModel());

        expect(twoOrMore).toBe(fiveOrMore);
        expect(JSON.parse(twoOrMore)).toMatchObject({
            having: {
                kind: 'binary',
                operator: 'gte',
                operand: {
                    kind: 'aggregate',
                    function: 'count',
                },
                valueShape: 'scalar',
            },
        });
    });

    it('includes grouped aggregate ordering and paging shape in select SQL cache keys', () => {
        const metadata = createOrderMetadata();
        const orders = new Queryable(metadata, new RecordingExecutor());

        const newestKey = buildSelectSqlCacheKey(metadata, orders
            .groupBy(order => ({ customerEmail: order.customerEmail }))
            .orderByDescending(group => group.count())
            .take(5)
            .select(group => ({
                customerEmail: group.key.customerEmail,
                orderCount: group.count(),
            }))
            .toQueryModel());
        const alphabeticalKey = buildSelectSqlCacheKey(metadata, orders
            .groupBy(order => ({ customerEmail: order.customerEmail }))
            .orderBy(group => group.key.customerEmail)
            .take(5)
            .select(group => ({
                customerEmail: group.key.customerEmail,
                orderCount: group.count(),
            }))
            .toQueryModel());

        expect(newestKey).not.toBe(alphabeticalKey);
        expect(JSON.parse(newestKey)).toMatchObject({
            aggregateOrderings: [{
                direction: 'desc',
                operand: {
                    kind: 'aggregate',
                    function: 'count',
                },
            }],
            hasLimit: true,
        });
    });

});

import { postgres } from '../../src/providers/postgres';
import { Queryable } from '../../src/experimental';
import { createOrderMetadata, Order, RecordingExecutor } from './support';

describe('aggregate query model construction', () => {
    it('records ungrouped aggregate projection expressions', () => {
        const metadata = createOrderMetadata();
        const executor = new RecordingExecutor();

        const query = new Queryable(metadata, executor)
            .where(order => order.createdAt.gte(new Date('2026-01-01T00:00:00.000Z')))
            .aggregate(agg => ({
                orderCount: agg.count(),
                paidOrderCount: agg.count(order => order.paidAt),
                totalCents: agg.sum(order => order.totalCents),
                averageCents: agg.avg(order => order.totalCents),
                latestOrderAt: agg.max(order => order.createdAt),
                firstEmail: agg.min(order => order.customerEmail),
            }));

        expect(query.toQueryModel()).toMatchObject({
            entityType: Order,
            aggregateProjection: [
                { alias: 'orderCount', function: 'count' },
                { alias: 'paidOrderCount', function: 'count', propertyName: 'paidAt' },
                { alias: 'totalCents', function: 'sum', propertyName: 'totalCents' },
                { alias: 'averageCents', function: 'avg', propertyName: 'totalCents' },
                { alias: 'latestOrderAt', function: 'max', propertyName: 'createdAt' },
                { alias: 'firstEmail', function: 'min', propertyName: 'customerEmail' },
            ],
        });
        expect(query.toQueryModel().projection).toBeUndefined();
        expect(query.toQueryModel().predicate?.node).toMatchObject({
            kind: 'binary',
            propertyName: 'createdAt',
        });
    });

    it('validates aggregate selector shapes', () => {
        const metadata = createOrderMetadata();
        const query = new Queryable(metadata, new RecordingExecutor());

        expect(() => query.aggregate(() => ({ nested: { total: 1 } }) as never))
            .toThrow('Aggregate projection alias \'nested\' must select an aggregate expression.');
        expect(() => query.aggregate(() => ({}) as never))
            .toThrow('Aggregate selectors must select at least one aggregate expression.');
        expect(() => query.aggregate(agg => ({ total: agg.sum(() => 'totalCents' as never) })))
            .toThrow('Aggregate sum selectors must return a mapped query field.');
    });

    it('records group key and grouped aggregate projection expressions', () => {
        const metadata = createOrderMetadata();
        const executor = new RecordingExecutor();

        const query = new Queryable(metadata, executor)
            .groupBy(order => ({
                workspaceId: order.workspaceId,
                customerEmail: order.customerEmail,
            }))
            .select(group => ({
                workspaceId: group.key.workspaceId,
                customerEmail: group.key.customerEmail,
                orderCount: group.count(),
                totalCents: group.sum(order => order.totalCents),
            }));

        expect(query.toQueryModel()).toMatchObject({
            entityType: Order,
            groupKeys: [
                { alias: 'workspaceId', propertyName: 'workspaceId' },
                { alias: 'customerEmail', propertyName: 'customerEmail' },
            ],
            groupKeyProjection: [
                { alias: 'workspaceId', keyAlias: 'workspaceId', propertyName: 'workspaceId' },
                { alias: 'customerEmail', keyAlias: 'customerEmail', propertyName: 'customerEmail' },
            ],
            aggregateProjection: [
                { alias: 'orderCount', function: 'count' },
                { alias: 'totalCents', function: 'sum', propertyName: 'totalCents' },
            ],
        });
    });

    it('records provider-owned date-bucket group key expressions', () => {
        const metadata = createOrderMetadata();
        const executor = new RecordingExecutor();

        const query = new Queryable(metadata, executor)
            .groupBy(order => ({
                day: postgres.dateBucket('day', order.createdAt, { timeZone: 'UTC' }),
            }))
            .select(group => ({
                day: group.key.day,
                orderCount: group.count(),
            }));

        expect(query.toQueryModel()).toMatchObject({
            groupKeys: [{
                kind: 'dateBucket',
                alias: 'day',
                provider: 'postgres',
                precision: 'day',
                timeZone: 'UTC',
                propertyName: 'createdAt',
            }],
            groupKeyProjection: [{
                kind: 'dateBucket',
                alias: 'day',
                keyAlias: 'day',
                provider: 'postgres',
                precision: 'day',
                timeZone: 'UTC',
                propertyName: 'createdAt',
            }],
            aggregateProjection: [{
                alias: 'orderCount',
                function: 'count',
            }],
        });
    });

    it('validates Postgres date-bucket group key inputs at runtime', () => {
        const metadata = createOrderMetadata();
        const orders = new Queryable(metadata, new RecordingExecutor());

        expect(() => orders.groupBy(order => ({
            day: postgres.dateBucket('quarter' as never, order.createdAt, { timeZone: 'UTC' }),
        }))).toThrow('Date bucket precision must be one of: hour, day, week, month.');

        expect(() => orders.groupBy(order => ({
            day: postgres.dateBucket('day', order.createdAt, { timeZone: ' ' }),
        }))).toThrow('Date bucket group keys require an explicit timeZone.');

        expect(() => orders.groupBy(order => ({
            day: postgres.dateBucket('day', order.createdAt, { timeZone: 42 } as never),
        }))).toThrow('Date bucket group keys require an explicit timeZone.');

        expect(() => orders.groupBy(order => ({
            day: postgres.dateBucket('day', order.createdAt, undefined as never),
        }))).toThrow('Date bucket group keys require an explicit timeZone.');
    });

    it('records grouped aggregate having predicate expressions', () => {
        const metadata = createOrderMetadata();
        const executor = new RecordingExecutor();

        const query = new Queryable(metadata, executor)
            .groupBy(order => ({ customerEmail: order.customerEmail }))
            .having(group => group.count().gte(2).and(group.key.customerEmail.contains('@example.com')))
            .select(group => ({
                customerEmail: group.key.customerEmail,
                orderCount: group.count(),
            }));

        expect(query.toQueryModel().having?.node).toMatchObject({
            kind: 'logical',
            operator: 'and',
            left: {
                kind: 'binary',
                operator: 'gte',
                operand: {
                    kind: 'aggregate',
                    function: 'count',
                },
                value: 2,
            },
            right: {
                kind: 'binary',
                operator: 'contains',
                operand: {
                    kind: 'groupKey',
                    keyAlias: 'customerEmail',
                    propertyName: 'customerEmail',
                },
                value: '@example.com',
            },
        });
    });

    it('records grouped aggregate ordering and paging expressions', () => {
        const metadata = createOrderMetadata();
        const executor = new RecordingExecutor();

        const query = new Queryable(metadata, executor)
            .groupBy(order => ({ customerEmail: order.customerEmail }))
            .orderByDescending(group => group.count())
            .orderBy(group => group.key.customerEmail)
            .skip(10)
            .take(5)
            .select(group => ({
                customerEmail: group.key.customerEmail,
                orderCount: group.count(),
            }));

        expect(query.toQueryModel()).toMatchObject({
            aggregateOrderings: [
                {
                    direction: 'desc',
                    operand: {
                        kind: 'aggregate',
                        function: 'count',
                    },
                },
                {
                    direction: 'asc',
                    operand: {
                        kind: 'groupKey',
                        keyAlias: 'customerEmail',
                        propertyName: 'customerEmail',
                    },
                },
            ],
            offset: 10,
            limit: 5,
        });
    });

    it('validates grouped aggregate selector shapes', () => {
        const metadata = createOrderMetadata();
        const query = new Queryable(metadata, new RecordingExecutor());

        expect(() => query.groupBy(() => ({}) as never))
            .toThrow('groupBy selectors must select at least one key field.');
        expect(() => query.groupBy(() => ({ bad: 'workspaceId' }) as never))
            .toThrow('Group key alias \'bad\' must select a mapped query field or provider-owned group expression.');
        expect(() => query
            .groupBy(order => ({ workspaceId: order.workspaceId }))
            .select(() => ({ bad: 'workspaceId' }) as never))
            .toThrow('Grouped aggregate projection alias \'bad\' must select a group key or aggregate expression.');
        expect(() => query
            .groupBy(order => ({ workspaceId: order.workspaceId }))
            .select(group => ({
                missing: (group.key as unknown as { missing: unknown }).missing,
            }) as never))
            .toThrow('Group key \'missing\' was not selected in groupBy().');
        expect(() => query
            .groupBy(order => ({ workspaceId: order.workspaceId }))
            .having(() => 'count >= 2' as never))
            .toThrow('having selectors must return a having predicate expression.');
    });

});

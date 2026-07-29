import { postgres } from '../../src/providers/postgres';
import { RecordingDatabaseConnection } from '../support/recording-database-connection';
import { createDb } from './support';

describe('aggregate result materialization', () => {
    it('executes aggregate projections as untracked plain rows', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        const latestOrderAt = new Date('2026-02-01T00:00:00.000Z');
        connection.queueResult({
            rows: [{
                orderCount: '3',
                paidOrderCount: '2',
                totalCents: '4200',
                averageCents: '1400',
                latestOrderAt,
                firstEmail: 'a@example.com',
            }],
            rowCount: 1,
        });

        const rows = await db.orders.aggregate(agg => ({
            orderCount: agg.count(),
            paidOrderCount: agg.count(order => order.paidAt),
            totalCents: agg.sum(order => order.totalCents),
            averageCents: agg.avg(order => order.totalCents),
            latestOrderAt: agg.max(order => order.createdAt),
            firstEmail: agg.min(order => order.customerEmail),
        })).toArray();

        expect(rows).toEqual([{
            orderCount: 3,
            paidOrderCount: 2,
            totalCents: 4200,
            averageCents: 1400,
            latestOrderAt,
            firstEmail: 'a@example.com',
        }]);
        expect(connection.statements).toEqual([{
            text: 'select count(*)::int as "orderCount", count("paid_at") as "paidOrderCount", sum("total_cents") as "totalCents", avg("total_cents") as "averageCents", max("created_at") as "latestOrderAt", min("customer_email") as "firstEmail" from "orders" where ("archived_at" is null and "workspace_id" = $1)',
            values: ['wrk_1'],
        }]);
        expect(db.changeTracker.entries()).toHaveLength(0);
    });

    it('materializes empty input aggregate semantics', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        connection.queueResult({
            rows: [{
                orderCount: '0',
                totalCents: null,
                averageCents: null,
                latestOrderAt: null,
            }],
            rowCount: 1,
        });

        await expect(db.orders.aggregate(agg => ({
            orderCount: agg.count(),
            totalCents: agg.sum(order => order.totalCents),
            averageCents: agg.avg(order => order.totalCents),
            latestOrderAt: agg.max(order => order.createdAt),
        })).single()).resolves.toEqual({
            orderCount: 0,
            totalCents: null,
            averageCents: null,
            latestOrderAt: null,
        });
    });

    it('executes grouped aggregate projections as untracked plain rows', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        const latestOrderAt = new Date('2026-02-01T00:00:00.000Z');
        connection.queueResult({
            rows: [
                {
                    workspaceId: 'wrk_1',
                    customerEmail: 'a@example.com',
                    orderCount: '2',
                    totalCents: '4200',
                    latestOrderAt,
                },
                {
                    workspaceId: 'wrk_1',
                    customerEmail: 'b@example.com',
                    orderCount: '1',
                    totalCents: null,
                    latestOrderAt: null,
                },
            ],
            rowCount: 2,
        });

        const rows = await db.orders
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
            .toArray();

        expect(rows).toEqual([
            {
                workspaceId: 'wrk_1',
                customerEmail: 'a@example.com',
                orderCount: 2,
                totalCents: 4200,
                latestOrderAt,
            },
            {
                workspaceId: 'wrk_1',
                customerEmail: 'b@example.com',
                orderCount: 1,
                totalCents: null,
                latestOrderAt: null,
            },
        ]);
        expect(connection.statements).toEqual([{
            text: 'select "workspace_id" as "workspaceId", "customer_email" as "customerEmail", count(*)::int as "orderCount", sum("total_cents") as "totalCents", max("created_at") as "latestOrderAt" from "orders" where ("archived_at" is null and "workspace_id" = $1) group by "workspace_id", "customer_email"',
            values: ['wrk_1'],
        }]);
        expect(db.changeTracker.entries()).toHaveLength(0);
    });

    it('materializes Postgres date-bucket aggregate keys as dates', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        const day = new Date('2026-02-01T00:00:00.000Z');
        connection.queueResult({
            rows: [{
                day: day.toISOString(),
                orderCount: '2',
            }],
            rowCount: 1,
        });

        const rows = await db.orders
            .groupBy(order => ({
                day: postgres.dateBucket('day', order.createdAt, { timeZone: 'UTC' }),
            }))
            .select(group => ({
                day: group.key.day,
                orderCount: group.count(),
            }))
            .toArray();

        expect(rows).toEqual([{
            day,
            orderCount: 2,
        }]);
        expect(connection.statements).toEqual([{
            text: 'select date_trunc(\'day\', timezone(\'UTC\', "created_at")) as "day", count(*)::int as "orderCount" from "orders" where ("archived_at" is null and "workspace_id" = $1) group by date_trunc(\'day\', timezone(\'UTC\', "created_at"))',
            values: ['wrk_1'],
        }]);
        expect(db.changeTracker.entries()).toHaveLength(0);
    });

    it('returns zero rows for empty grouped aggregate inputs', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        connection.queueResult({
            rows: [],
            rowCount: 0,
        });

        await expect(db.orders
            .groupBy(order => ({ customerEmail: order.customerEmail }))
            .select(group => ({
                customerEmail: group.key.customerEmail,
                orderCount: group.count(),
            }))
            .toArray()).resolves.toEqual([]);
    });

});

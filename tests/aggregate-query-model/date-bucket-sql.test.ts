import type { SqlDialect } from '../../packages/core/src/adapter';
import { postgres } from '../../packages/postgres/src';
import { RecordingDatabaseConnection } from '../support/recording-database-connection';
import { createDb } from './support';

describe('Postgres aggregate date-bucket SQL', () => {
    it('renders Postgres date-bucket grouped aggregate SQL with having and ordering', () => {
        const db =  createDb();
        const start = new Date('2026-01-01T00:00:00.000Z');
        const bucketStart = new Date('2026-02-01T00:00:00.000Z');

        expect(db.orders
            .where(order => order.createdAt.gte(start))
            .groupBy(order => ({
                day: postgres.dateBucket('day', order.createdAt, { timeZone: 'UTC' }),
            }))
            .having(group => group.key.day.gte(bucketStart))
            .orderBy(group => group.key.day.asc())
            .select(group => ({
                day: group.key.day,
                orderCount: group.count(),
                totalCents: group.sum(order => order.totalCents),
            }))
            .toSql()).toEqual({
            text: 'select date_trunc(\'day\', timezone(\'UTC\', "created_at")) as "day", count(*)::int as "orderCount", sum("total_cents") as "totalCents" from "orders" where (("created_at" >= $1 and "archived_at" is null) and "workspace_id" = $2) group by date_trunc(\'day\', timezone(\'UTC\', "created_at")) having date_trunc(\'day\', timezone(\'UTC\', "created_at")) >= $3 order by date_trunc(\'day\', timezone(\'UTC\', "created_at")) asc',
            values: [start, 'wrk_1', bucketStart],
        });
    });

    it('escapes Postgres date-bucket precision and time-zone literals in SQL', () => {
        const db =  createDb();

        expect(db.orders
            .groupBy(order => ({
                day: postgres.dateBucket('day', order.createdAt, { timeZone: 'UTC\'quoted' }),
            }))
            .select(group => ({
                day: group.key.day,
                orderCount: group.count(),
            }))
            .toSql()).toEqual({
            text: 'select date_trunc(\'day\', timezone(\'UTC\'\'quoted\', "created_at")) as "day", count(*)::int as "orderCount" from "orders" where ("archived_at" is null and "workspace_id" = $1) group by date_trunc(\'day\', timezone(\'UTC\'\'quoted\', "created_at"))',
            values: ['wrk_1'],
        });
    });

    it('rejects Postgres date-bucket group keys for non-Postgres SQL dialects', () => {
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

        expect(() => db.orders
            .groupBy(order => ({ day: postgres.dateBucket('day', order.createdAt, { timeZone: 'UTC' }) }))
            .select(group => ({ day: group.key.day, orderCount: group.count() }))
            .toSql()).toThrow('Postgres date bucket group keys require the postgres SQL dialect.');
    });

});

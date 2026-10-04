import type { DatabaseRuntimeProviderServices } from '../../packages/core/src/adapter';
import { postgresProviderServices } from '../../packages/postgres/src';
import { mySqlProviderServices } from '../../packages/mysql/src';
import { requireDefined } from '../support/require-defined';
import { SparseArrayContext, seedSparseArrayRows } from '../support/sparse-array-support';

async function qualifySparseRefusal(provider: DatabaseRuntimeProviderServices, target: string, index: number, untracked: boolean): Promise<void> {
    const context = SparseArrayContext.create(index, provider, target);
    const cleanup = async (): Promise<void> => {
        await context.database.connection.query({ text: 'drop table if exists sparse_array_rows', values: [] });
    };
    try {
        await cleanup();
        await seedSparseArrayRows(context, provider.name);
        const rows = context.rows.orderBy(row => row.id);
        await expect((untracked ? rows.asNoTracking() : rows).toArray()).rejects.toThrow('SparseArrayRow.items');
        expect(context.changeTracker.entries().map(entry => entry.keyValue)).toEqual(untracked ? [] : ['a-safe']);
        const stored = await context.database.connection.query({ text: 'select items from sparse_array_rows where id = \'b-refused\'', values: [] });
        const value = stored.rows[0]?.items;
        const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
        expect(parsed).toEqual(['first', 'middle', 'last']);
        expect(await context.rows.count()).toBe(2);
    } finally {
        try {
            await cleanup();
        } finally {
            await context.dispose();
        }
    }
}

const cases = [0, 1, 2].flatMap(index => [false, true].map(untracked => ({ index, untracked })));
const postgresUrl = process.env.DATABASE_URL;
const postgres = process.env.RUN_POSTGRES_TESTS === 'true' && postgresUrl ? describe : describe.skip;
postgres('sparse-array refusal against live Postgres JSON', () => {
    it.each(cases)('refuses slot $index without retaining the incomplete row, untracked=$untracked', async ({ index, untracked }) => {
        await qualifySparseRefusal(postgresProviderServices, requireDefined(postgresUrl), index, untracked);
    });
});

const mysqlUrl = process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL;
const mysql = process.env.RUN_MYSQL_TESTS === 'true' && mysqlUrl ? describe : describe.skip;
mysql('sparse-array refusal against live MySQL JSON', () => {
    it.each(cases)('refuses slot $index without retaining the incomplete row, untracked=$untracked', async ({ index, untracked }) => {
        await qualifySparseRefusal(mySqlProviderServices, requireDefined(mysqlUrl), index, untracked);
    });
});

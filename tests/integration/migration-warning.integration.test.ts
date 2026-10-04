import { MigrationDataLossError, MigrationRunner, diffModelSnapshots } from '../../packages/core/src/migrations/api';
import { PostgresDatabaseConnection, postgresProviderServices } from '../../packages/postgres/src';
import { MySqlDatabaseConnection, mySqlProviderServices } from '../../packages/mysql/src';
import { joinSnapshot } from '../support/join-principal-rename-support';
import { requireDefined } from '../support/require-defined';

type WarningProvider = typeof postgresProviderServices | typeof mySqlProviderServices;
type WarningConnection = PostgresDatabaseConnection | MySqlDatabaseConnection;

async function qualifyWarning(provider: WarningProvider, connection: WarningConnection, kind: string): Promise<void> {
    const marker = (index: number): string => provider.dialect.name === 'postgres' ? `$${String(index + 1)}` : '?';
    const query = async (text: string, values: unknown[] = []): Promise<unknown> => (await connection.query({ text, values })).rows;
    const cleanup = async (): Promise<void> => {
        for (const table of ['join_entry_tags', 'join_entries', 'join_tags', '__entitykit_migrations']) {
            await query(`drop table if exists ${provider.dialect.quoteIdentifier(table)}`);
        }
    };
    try {
        await cleanup();
        const before = await joinSnapshot();
        const after = kind === 'tables' ? { formatVersion: 1 as const, entities: [] } : { ...before, entities: before.entities.map(entity => ({ ...entity,
            manyToManyRelationships: kind === 'join' ? [] : entity.manyToManyRelationships,
            properties: kind === 'column' && entity.tableName === 'join_entries'
                ? entity.properties.filter(property => property.propertyName !== 'label') : entity.properties,
        })) };
        const initial = diffModelSnapshots({ formatVersion: 1, entities: [] }, before)
            .toMigration('20261004001800_CreateNativeWarningJoin', 'CreateNativeWarningJoin');
        const removal = diffModelSnapshots(before, after).toMigration('20261004001801_RemoveNativeWarningFacet', 'RemoveNativeWarningFacet');
        const runner = new MigrationRunner(connection, provider.migrationDialect, provider.createMigrationBuilder);
        await runner.update([initial]);
        await query(`insert into join_entries values (${marker(0)}, ${marker(1)}, ${marker(2)})`, ['book', 'tenant', 'Novel']);
        await query(`insert into join_tags values (${marker(0)}, ${marker(1)}, ${marker(2)})`, ['tag', 'tenant', 'Fiction']);
        await query(`insert into join_entry_tags values (${marker(0)}, ${marker(1)})`, ['book', 'tag']);
        await expect(runner.update([initial, removal])).rejects.toBeInstanceOf(MigrationDataLossError);
        expect(await query('select label from join_entries')).toEqual([{ label: 'Novel' }]);
        expect(await query('select label from join_tags')).toEqual([{ label: 'Fiction' }]);
        expect(await query('select * from join_entry_tags')).toEqual([{ entry_id: 'book', tag_id: 'tag' }]);
        expect((await runner.getAppliedMigrations({ initializeHistory: false })).map(row => row.id)).toEqual([initial.id]);
        await expect(query(`insert into join_entry_tags values (${marker(0)}, ${marker(1)})`, ['missing', 'tag'])).rejects.toThrow();
        await runner.update([initial, removal], { allowDataLoss: true });
        expect((await runner.getAppliedMigrations({ initializeHistory: false })).map(row => row.id)).toEqual([initial.id, removal.id]);
        await expect(query(kind === 'column' ? 'select label from join_entries' : `select * from ${kind === 'join' ? 'join_entry_tags' : 'join_entries'}`))
            .rejects.toThrow();
    } finally {
        try {
            await cleanup();
        } finally {
            await connection.dispose();
        }
    }
}

const postgresUrl = process.env.DATABASE_URL;
const postgres = process.env.RUN_POSTGRES_TESTS === 'true' && postgresUrl ? describe : describe.skip;
postgres('reviewed migration warnings against live Postgres', () => {
    it.each(['join', 'column', 'tables'])('refuses %s removal before SQL and permits explicit approval', async kind => {
        await qualifyWarning(postgresProviderServices, new PostgresDatabaseConnection(requireDefined(postgresUrl)), kind);
    });
});

const mysqlUrl = process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL;
const mysql = process.env.RUN_MYSQL_TESTS === 'true' && mysqlUrl ? describe : describe.skip;
mysql('reviewed migration warnings against live MySQL', () => {
    it.each(['join', 'column', 'tables'])('refuses %s removal before SQL and permits explicit approval', async kind => {
        await qualifyWarning(mySqlProviderServices, new MySqlDatabaseConnection(requireDefined(mysqlUrl)), kind);
    });
});

import { MigrationError, MigrationRunner, diffModelSnapshots } from '../../packages/core/src/migrations/api';
import { PostgresDatabaseConnection, postgresProviderServices } from '../../packages/postgres/src';
import { MySqlDatabaseConnection, mySqlProviderServices } from '../../packages/mysql/src';
import { joinSnapshot } from '../support/join-principal-rename-support';
import { requireDefined } from '../support/require-defined';

type KeyProvider = typeof postgresProviderServices | typeof mySqlProviderServices;
type KeyConnection = PostgresDatabaseConnection | MySqlDatabaseConnection;

async function qualifyKeyRefusal(provider: KeyProvider, connection: KeyConnection, side: string): Promise<void> {
    const query = async (text: string): Promise<unknown> => (await connection.query({ text, values: [] })).rows;
    const cleanup = async (): Promise<void> => {
        for (const table of ['join_entry_tags', 'join_entries', 'join_tags', '__entitykit_migrations']) {
            await query(`drop table if exists ${provider.dialect.quoteIdentifier(table)}`);
        }
    };
    try {
        await cleanup();
        const before = await joinSnapshot({ composite: true });
        const initial = diffModelSnapshots({ formatVersion: 1, entities: [] }, before)
            .toMigration('20261004002200_CreateNativeKeyRefusal', 'CreateNativeKeyRefusal');
        const runner = new MigrationRunner(connection, provider.migrationDialect, provider.createMigrationBuilder);
        await runner.update([initial]);
        await query('insert into join_entries values (\'book\', \'tenant\', \'Novel\')');
        await query('insert into join_tags values (\'tag\', \'tenant\', \'Fiction\')');
        await query('insert into join_entry_tags values (\'tenant\', \'book\', \'tenant\', \'tag\')');
        const after = { ...before, entities: before.entities.map(entity => ({ ...entity,
            keyProperties: side === 'both' || entity.tableName === (side === 'source' ? 'join_entries' : 'join_tags')
                ? [...entity.keyProperties ?? []].reverse() : entity.keyProperties,
        })) };
        expect(() => diffModelSnapshots(before, after)).toThrow(MigrationError);
        expect(await query('select * from join_entry_tags')).toEqual([{ entry_tenant: 'tenant', entry_id: 'book', tag_tenant: 'tenant', tag_id: 'tag' }]);
        expect(await query('select label from join_entries')).toEqual([{ label: 'Novel' }]);
        expect(await query('select label from join_tags')).toEqual([{ label: 'Fiction' }]);
        expect((await runner.getAppliedMigrations({ initializeHistory: false })).map(row => row.id)).toEqual([initial.id]);
        await expect(query('insert into join_entry_tags values (\'tenant\', \'missing\', \'tenant\', \'tag\')')).rejects.toThrow();
        await expect(query('delete from join_entries')).rejects.toThrow();
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
postgres('existing key-order refusal against live Postgres', () => {
    it.each(['source', 'target', 'both'])('preserves populated %s principals, references and history', async side => {
        await qualifyKeyRefusal(postgresProviderServices, new PostgresDatabaseConnection(requireDefined(postgresUrl)), side);
    });
});

const mysqlUrl = process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL;
const mysql = process.env.RUN_MYSQL_TESTS === 'true' && mysqlUrl ? describe : describe.skip;
mysql('existing key-order refusal against live MySQL', () => {
    it.each(['source', 'target', 'both'])('preserves populated %s principals, references and history', async side => {
        await qualifyKeyRefusal(mySqlProviderServices, new MySqlDatabaseConnection(requireDefined(mysqlUrl)), side);
    });
});

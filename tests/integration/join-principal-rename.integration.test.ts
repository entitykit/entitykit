import { MigrationRunner, diffModelSnapshots } from '../../packages/core/src/migrations/api';
import { PostgresDatabaseConnection, postgresProviderServices } from '../../packages/postgres/src';
import { MySqlDatabaseConnection, mySqlProviderServices } from '../../packages/mysql/src';
import { joinSnapshot } from '../support/join-principal-rename-support';
import { requireDefined } from '../support/require-defined';

type JoinProvider = typeof postgresProviderServices | typeof mySqlProviderServices;
type JoinConnection = PostgresDatabaseConnection | MySqlDatabaseConnection;

async function qualifyJoinRename(provider: JoinProvider, connection: JoinConnection, side: string, composite: boolean): Promise<void> {
    const replacing = side === 'replacement';
    const secondJoinName = replacing ? 'join_featured_tags' : undefined;
    const marker = (index: number): string => provider.dialect.name === 'postgres' ? `$${String(index + 1)}` : '?';
    const query = async (text: string, values: unknown[] = []): Promise<unknown> => (await connection.query({ text, values })).rows;
    const cleanup = async (): Promise<void> => {
        for (const table of ['join_featured_tags', 'join_entry_tags', 'join_entries', 'join_tags', '__entitykit_migrations']) {
            await query(`drop table if exists ${provider.dialect.quoteIdentifier(table)}`);
        }
    };
    const renamed = { sourceRenamed: side !== 'target', targetRenamed: side !== 'source', composite };
    const verify = async (afterRename: boolean): Promise<void> => {
        const source = afterRename && renamed.sourceRenamed ? 'entry_key' : 'legacy_id';
        const target = afterRename && renamed.targetRenamed ? 'tag_key' : 'legacy_id';
        expect(await query(`select ${provider.dialect.quoteIdentifier(source)} as id, tenant, label from join_entries`))
            .toEqual([{ id: 'book', tenant: 'tenant', label: 'Novel' }]);
        expect(await query(`select ${provider.dialect.quoteIdentifier(target)} as id, tenant, label from join_tags`))
            .toEqual([{ id: 'tag', tenant: 'tenant', label: 'Fiction' }]);
        expect(await query('select * from join_entry_tags')).toEqual([composite
            ? { entry_tenant: 'tenant', entry_id: 'book', tag_tenant: 'tenant', tag_id: 'tag' }
            : { entry_id: 'book', tag_id: 'tag' }]);
        const invalid = composite
            ? [['tenant', 'missing', 'tenant', 'tag'], ['tenant', 'book', 'tenant', 'missing'], ['other', 'book', 'tenant', 'tag']]
            : [['missing', 'tag'], ['book', 'missing']];
        for (const values of invalid) {
            await expect(query(`insert into join_entry_tags values (${values.map((_value, index) => marker(index)).join(', ')})`, values))
                .rejects.toThrow();
        }
        await expect(query('delete from join_entries')).rejects.toThrow();
        await expect(query('delete from join_tags')).rejects.toThrow();
    };
    try {
        await cleanup();
        const before = await joinSnapshot({ composite, secondJoinName });
        const mapped = await joinSnapshot({ ...renamed, secondJoinName });
        const after = replacing ? { ...mapped, entities: mapped.entities.map(entity => ({ ...entity,
            manyToManyRelationships: entity.manyToManyRelationships?.map(relationship => relationship.joinTableName !== secondJoinName
                ? relationship : { ...relationship, deleteBehavior: relationship.deleteBehavior === 'cascade' ? 'restrict' : 'cascade' }),
        })) } : mapped;
        const initial = diffModelSnapshots({ formatVersion: 1, entities: [] }, before)
            .toMigration('20261004001300_CreateNativeJoin', 'CreateNativeJoin');
        const columns = [
            ...renamed.sourceRenamed ? [{ tableName: 'join_entries', from: 'legacy_id', to: 'entry_key' }] : [],
            ...renamed.targetRenamed ? [{ tableName: 'join_tags', from: 'legacy_id', to: 'tag_key' }] : [],
        ];
        const rename = diffModelSnapshots(before, after, { renameHints: { columns } })
            .toMigration('20261004001301_RenameNativeJoin', 'RenameNativeJoin');
        const runner = new MigrationRunner(connection, provider.migrationDialect, provider.createMigrationBuilder);
        await runner.update([initial]);
        await query(`insert into join_entries values (${marker(0)}, ${marker(1)}, ${marker(2)})`, ['book', 'tenant', 'Novel']);
        await query(`insert into join_tags values (${marker(0)}, ${marker(1)}, ${marker(2)})`, ['tag', 'tenant', 'Fiction']);
        const values = composite ? ['tenant', 'book', 'tenant', 'tag'] : ['book', 'tag'];
        await query(`insert into join_entry_tags values (${values.map((_value, index) => marker(index)).join(', ')})`, values);
        if (replacing) await query(`insert into join_featured_tags values (${marker(0)}, ${marker(1)})`, ['book', 'tag']);
        await verify(false);
        await runner.update([initial, rename], replacing ? { allowDataLoss: true } : {});
        await verify(true);
        if (replacing) {
            expect(await query('select * from join_featured_tags')).toEqual([]);
            await query(`insert into join_featured_tags values (${marker(0)}, ${marker(1)})`, ['book', 'tag']);
        }
        await runner.update([initial, rename], { target: initial.id });
        await verify(false);
        if (replacing) {
            expect(await query('select * from join_featured_tags')).toEqual([]);
            await query(`insert into join_featured_tags values (${marker(0)}, ${marker(1)})`, ['book', 'tag']);
            await expect(query(`insert into join_featured_tags values (${marker(0)}, ${marker(1)})`, ['missing', 'tag'])).rejects.toThrow();
        }
        expect((await runner.getAppliedMigrations({ initializeHistory: false })).map(row => row.id)).toEqual([initial.id]);
    } finally {
        try {
            await cleanup();
        } finally {
            await connection.dispose();
        }
    }
}

const cases = [...[false, true].flatMap(composite => ['source', 'target', 'both'].map(side => ({ composite, side }))),
    { composite: false, side: 'replacement' }];
const postgresUrl = process.env.DATABASE_URL;
const postgres = process.env.RUN_POSTGRES_TESTS === 'true' && postgresUrl ? describe : describe.skip;
postgres('join principal renames against live Postgres', () => {
    it.each(cases)('preserves $side keys and associations, composite=$composite', async ({ side, composite }) => {
        await qualifyJoinRename(postgresProviderServices, new PostgresDatabaseConnection(requireDefined(postgresUrl)), side, composite);
    });
});

const mysqlUrl = process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL;
const mysql = process.env.RUN_MYSQL_TESTS === 'true' && mysqlUrl ? describe : describe.skip;
mysql('join principal renames against live MySQL', () => {
    it.each(cases)('preserves $side keys and associations, composite=$composite', async ({ side, composite }) => {
        await qualifyJoinRename(mySqlProviderServices, new MySqlDatabaseConnection(requireDefined(mysqlUrl)), side, composite);
    });
});

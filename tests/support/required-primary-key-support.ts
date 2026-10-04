import { ModelBuilder } from '../../packages/core/src/model/model-builder';
import type { Model } from '../../packages/core/src/model/model';
import type { DatabaseConnection, DatabaseProviderServices } from '../../packages/core/src/adapter';
import { SchemaSqlBuilder } from '../../packages/core/src/schema/schema-sql-builder';
import { diffModelSnapshots } from '../../packages/core/src/migrations/api';
import { PostgresDatabaseConnection, postgresProviderServices } from '../../packages/postgres/src';
import { MySqlDatabaseConnection, mySqlProviderServices } from '../../packages/mysql/src';
import { SqliteDatabaseConnection, sqliteProviderServices, sqliteMigrationDialect } from '../../packages/sqlite/src';
import { emptySnapshot } from '../model-differ-support';
import { scaffoldedMigration } from './migration-table-order-support';

class RequiredBook {
    public id!: string;
    public title?: string;
    public subtitle?: string;
}

export function requiredKeyModel(type: string, generated = false): Model {
    return new ModelBuilder().entity(RequiredBook, entity => {
        entity.toTable('ek_required_key_catalog').hasKey(row => row.id);
        const id = entity.property(row => row.id).hasColumnType(type).isRequired();
        if (generated) id.useSqliteRowId({ preventReuse: true });
        entity.property(row => row.title).hasColumnType('varchar(64)').isOptional();
    }).build();
}

type Provider = 'sqlite' | 'postgres' | 'mysql';
const modes = ['schema', 'migration', 'callback', 'scaffold'] as const;

export function defineRequiredPrimaryKeyProviderTests(provider: Provider, url: () => string): void {
    const services: DatabaseProviderServices = provider === 'sqlite' ? sqliteProviderServices
        : provider === 'postgres' ? postgresProviderServices : mySqlProviderServices;
    const cases = modes.flatMap(mode => ['text', 'varchar(64)'].map(type => ({ mode, type })));
    it.each(cases)('rejects null and omitted required $type keys through $mode DDL', async ({ mode, type }) => {
        const connection = connectionFor(provider, url());
        const query = async (text: string): Promise<void> => {
            await connection.query({ text, values: [] });
        };
        try {
            const builder = services.createMigrationBuilder();
            const model = requiredKeyModel(type);
            if (mode === 'schema') await query(new SchemaSqlBuilder(services.dialect).build(model));
            else {
                if (mode === 'migration') builder.createTable('ek_required_key_catalog', [
                    { name: 'id', type, primaryKey: true, nullable: false }, { name: 'title', type: 'varchar(64)', nullable: true },
                ]);
                else if (mode === 'callback') builder.createTable('ek_required_key_catalog', table => {
                    table.column('id', type).primaryKey();
                    table.column('title', 'varchar(64)').nullable();
                });
                else scaffoldedMigration(emptySnapshot, model.toSnapshot()).migration.up(builder);
                for (const statement of builder.statements) await connection.query(statement);
            }
            await query('insert into ek_required_key_catalog (id, title) values (\'book-1\', null)');
            await expect(query('insert into ek_required_key_catalog (id, title) values (null, \'invalid\')')).rejects.toThrow();
            await expect(query('insert into ek_required_key_catalog (title) values (\'missing key\')')).rejects.toThrow();
            expect((await connection.query({ text: 'select id from ek_required_key_catalog', values: [] })).rows).toEqual([{ id: 'book-1' }]);
        } finally {
            try {
                await query('drop table if exists ek_required_key_catalog');
            } finally {
                await connection.dispose?.();
            }
        }
    });

    if (provider === 'sqlite') {
        it.each(['id', 'name', 'checksum', 'entitykit_version'])('requires the migration history %s field', async field => {
            const connection = connectionFor(provider, url());
            try {
                await connection.query(sqliteMigrationDialect.createMigrationHistoryTableStatement());
                const values: Array<string | null> = ['history-id', 'CreateBooks', 'checksum', '0.1.0-alpha.2'];
                values[['id', 'name', 'checksum', 'entitykit_version'].indexOf(field)] = null;
                await expect(connection.query({ text: 'insert into __entitykit_migrations (id, name, checksum, entitykit_version) values (?, ?, ?, ?)', values })).rejects.toThrow();
                expect((await connection.query({ text: 'select id from __entitykit_migrations', values: [] })).rows).toEqual([]);
            } finally {
                await connection.dispose?.();
            }
        });

        it.each(['schema', 'migration'] as const)('preserves integer identity generation through %s DDL', async mode => {
            const connection = connectionFor(provider, url());
            const query = async (text: string): Promise<void> => {
                await connection.query({ text, values: [] });
            };
            try {
                if (mode === 'schema') await query(new SchemaSqlBuilder(services.dialect).build(requiredKeyModel('integer', true)));
                else {
                    const builder = services.createMigrationBuilder();
                    builder.createTable('ek_required_key_catalog', table => {
                        table.column('id', 'integer').primaryKey().generatedByRowId({ preventReuse: true });
                        table.column('title', 'varchar(64)').nullable();
                    });
                    for (const statement of builder.statements) await connection.query(statement);
                }
                await query('insert into ek_required_key_catalog (title) values (\'first\')');
                await query('insert into ek_required_key_catalog (id, title) values (null, \'second\')');
                expect((await connection.query({ text: 'select id from ek_required_key_catalog order by id', values: [] })).rows).toEqual([{ id: 1 }, { id: 2 }]);
                await query('delete from ek_required_key_catalog where id = 2');
                await query('insert into ek_required_key_catalog (title) values (\'third\')');
                expect((await connection.query({ text: 'select id from ek_required_key_catalog order by id', values: [] })).rows).toEqual([{ id: 1 }, { id: 3 }]);
            } finally {
                await connection.dispose?.();
            }
        });

        it('enforces required keys after rebuilding a legacy table without losing valid rows', async () => {
            const connection = connectionFor(provider, url());
            const query = async (text: string): Promise<void> => {
                await connection.query({ text, values: [] });
            };
            const previous = requiredKeyModel('text').toSnapshot();
            const target = { ...previous, entities: previous.entities.map(entity => ({
                ...entity, properties: entity.properties.map(property => property.propertyName === 'title' ? { ...property, columnType: 'varchar(128)' } : property),
            })) };
            try {
                await query('create table ek_required_key_catalog (id text primary key, title varchar(64))');
                await query('insert into ek_required_key_catalog (id, title) values (\'book-1\', \'preserved\')');
                const builder = services.createMigrationBuilder();
                diffModelSnapshots(previous, target).toMigration('rebuild-required-key', 'RebuildRequiredKey').up(builder);
                expect(builder.statements.some(statement => statement.text.includes('__entitykit_new_'))).toBe(true);
                await connection.transaction(async () => {
                    for (const statement of builder.statements) await connection.query(statement);
                });
                expect((await connection.query({ text: 'select id, title from ek_required_key_catalog', values: [] })).rows).toEqual([{ id: 'book-1', title: 'preserved' }]);
                await expect(query('insert into ek_required_key_catalog (id) values (null)')).rejects.toThrow();
            } finally {
                await connection.dispose?.();
            }
        });
    }
}

function connectionFor(provider: Provider, url: string): DatabaseConnection {
    if (provider === 'sqlite') return new SqliteDatabaseConnection(url);
    if (provider === 'postgres') return new PostgresDatabaseConnection(url);
    return new MySqlDatabaseConnection(url);
}

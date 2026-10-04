import { MigrationSqlGenerator, contextMigrations, diffModelSnapshots } from '../packages/core/src/migrations/api';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { postgresProviderServices } from '../packages/postgres/src';
import { mySqlProviderServices } from '../packages/mysql/src';
import { MainSchemaContext, expectMainSchemaState, schemaRows, seedMainSchema } from './support/main-schema-support';

describe('SQLite implicit main schema through public APIs', () => {
    it.each([undefined, 'main', 'MAIN'])('creates a populated catalog with indexes and both relationship kinds in schema %s', async schema => {
        const context = MainSchemaContext.create(schema);
        try {
            await context.database.ensureCreated();
            await seedMainSchema(context);
            await expectMainSchemaState(context);
            expect(await schemaRows(context, 'select "main"."id" from schema_entries as "main"')).toEqual([{ id: 'book' }]);
            expect(context.database.createScript()).not.toContain('create schema');
        } finally {
            await context.dispose();
        }
    });

    it.each(['main', 'MAIN'])('applies, rebuilds and rolls back a catalog explicitly mapped to %s', async schema => {
        const context = MainSchemaContext.create(schema);
        try {
            const migrations = contextMigrations(context);
            const before = migrations.createModelSnapshot();
            const after = { ...before, entities: before.entities.map(entity => entity.tableName === 'schema_entries'
                ? { ...entity, properties: entity.properties.map(property => property.propertyName === 'label'
                    ? { ...property, isRequired: false } : property) } : entity) };
            const initial = diffModelSnapshots({ formatVersion: 1, entities: [] }, before)
                .toMigration('20261004000200_CreateMainSchema', 'CreateMainSchema');
            const rebuilt = diffModelSnapshots(before, after).toMigration('20261004000201_RebuildMainSchema', 'RebuildMainSchema');
            await migrations.update([initial]);
            await seedMainSchema(context);
            await migrations.update([initial, rebuilt], { allowDataLoss: true });
            await expectMainSchemaState(context);
            await migrations.update([initial, rebuilt], { target: initial.id });
            await expectMainSchemaState(context);
            await migrations.update([initial, rebuilt], { target: '0' });
            expect(await schemaRows(context, 'select name from sqlite_master where name like \'schema_%\'' )).toEqual([]);
        } finally {
            await context.dispose();
        }
    });

    it.each(['app', 'temp', ' main ', ''])('refuses unsupported namespace %j before executing schema SQL', async schema => {
        const context = MainSchemaContext.create(schema);
        const query = jest.spyOn(context.database.connection, 'query');
        try {
            await expect(context.database.ensureCreated()).rejects.toThrow('SQLite schema');
            expect(query).not.toHaveBeenCalled();
        } finally {
            await context.dispose();
        }
    });

    it('refuses an unsupported namespace declared only by a join table before executing any SQL', async () => {
        const context = MainSchemaContext.create('main', 'app');
        const query = jest.spyOn(context.database.connection, 'query');
        try {
            await expect(context.database.ensureCreated()).rejects.toThrow('SQLite schema');
            expect(query).not.toHaveBeenCalled();
        } finally {
            await context.dispose();
        }
    });

    it.each(['main', 'MAIN', 'app'])('refuses to drop schema %s without emitting a statement', schema => {
        const builder = sqliteProviderServices.createMigrationBuilder();
        expect(() => builder.dropSchema(schema)).toThrow('SQLite schema');
        expect(builder.statements).toEqual([]);
    });

    it.each(['app', 'temp', ''])('refuses namespace %j in an isolated index or foreign-key operation', schema => {
        const builder = sqliteProviderServices.createMigrationBuilder();
        expect(() => builder.createIndex({ name: 'ix_isolated', tableName: 'schema_entries', schemaName: schema, columns: ['id'] }))
            .toThrow('SQLite schema');
        expect(() => builder.createTable('schema_child', [{ name: 'owner', type: 'text' }], undefined, { foreignKeys: [{
            name: 'fk_isolated', columns: ['owner'], principalTableName: 'schema_entries', principalSchemaName: schema,
            principalColumns: ['id'],
        }] })).toThrow('SQLite schema');
        expect(builder.statements).toEqual([]);
    });

    it.each([
        ['postgres', postgresProviderServices, '"main"."schema_entries"'],
        ['mysql', mySqlProviderServices, '`main`.`schema_entries`'],
    ])('retains %s schema creation and qualified references', async (_name, provider, reference) => {
        const context = MainSchemaContext.create('main');
        try {
            const migration = diffModelSnapshots({ formatVersion: 1, entities: [] }, contextMigrations(context).createModelSnapshot())
                .toMigration('20261004000200_CreateMainSchema', 'CreateMainSchema');
            const generator = new MigrationSqlGenerator(provider.migrationDialect, provider.createMigrationBuilder);
            const up = generator.generateUpScript(migration);
            expect(up).toContain('create schema if not exists');
            expect(up).toContain(`references ${reference}`);
            expect(up).toContain(`on ${reference}`);
        } finally {
            await context.dispose();
        }
    });
});

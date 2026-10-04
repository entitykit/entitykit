import { diffModelSnapshots, MigrationSqlGenerator } from '../packages/core/src/migrations/api';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { postgresProviderServices } from '../packages/postgres/src';
import { mySqlProviderServices } from '../packages/mysql/src';
import { joinSnapshot } from './support/join-principal-rename-support';

describe('declared primary-key order in migrations', () => {
    it.each([
        ['sqlite', sqliteProviderServices], ['postgres', postgresProviderServices], ['mysql', mySqlProviderServices],
    ])('preserves %s key order while retaining the configured physical column layout', async (_name, provider) => {
        const snapshot = await joinSnapshot({ composite: true });
        const migration = diffModelSnapshots({ formatVersion: 1, entities: [] }, snapshot)
            .toMigration('20261004001400_CreateOrderedKeys', 'CreateOrderedKeys');
        const generator = new MigrationSqlGenerator(provider.migrationDialect, provider.createMigrationBuilder);
        const up = generator.generateUpScript(migration);
        const quote = (name: string): string => provider.dialect.quoteIdentifier(name);
        const collation = _name === 'mysql' ? ' collate utf8mb4_bin' : '';
        expect(up).toContain(`primary key (${quote('tenant')}, ${quote('legacy_id')})`);
        expect(up).toContain(`${quote('join_entries')} (${quote('legacy_id')} varchar(64)${collation} not null, ${quote('tenant')} varchar(64)${collation} not null`);
        expect(up).toContain(`(${quote('entry_tenant')}, ${quote('entry_id')}) references ${quote('join_entries')} (${quote('tenant')}, ${quote('legacy_id')})`);
    });

    it.each([
        ['duplicate', 0, 0], ['negative', -1, 0], ['fractional', 0.5, 1], ['out of range', 0, 2],
        ['infinite', 0, Infinity], ['NaN', Number.NaN, 1], ['partly omitted', 0, undefined],
    ] as const)('refuses %s key ordinals before emitting any statement', (_name, first, second) => {
        const builder = sqliteProviderServices.createMigrationBuilder();
        expect(() => builder.createTable('ordinal_entries', [
            { name: 'id', type: 'text', primaryKey: true, primaryKeyOrdinal: first },
            { name: 'tenant', type: 'text', primaryKey: true, primaryKeyOrdinal: second },
        ])).toThrow('primaryKeyOrdinal must give every key column a unique position from zero.');
        expect(builder.statements).toEqual([]);
    });

    it('refuses an ordinal on a non-key column before emitting SQL', () => {
        const builder = sqliteProviderServices.createMigrationBuilder();
        expect(() => builder.createTable('ordinal_entries', [
            { name: 'id', type: 'text', primaryKey: true },
            { name: 'label', type: 'text', primaryKeyOrdinal: 0 },
        ])).toThrow('Only primary-key columns may declare primaryKeyOrdinal.');
        expect(builder.statements).toEqual([]);
    });

    it('preserves unnamed inline keys and legacy column-order composite declarations', () => {
        const builder = sqliteProviderServices.createMigrationBuilder();
        builder.createTable('single_key', [{ name: 'id', type: 'text', primaryKey: true, primaryKeyOrdinal: 0 }]);
        builder.createTable('legacy_keys', [
            { name: 'id', type: 'text', primaryKey: true }, { name: 'tenant', type: 'text', primaryKey: true },
        ]);
        builder.createTable('keyless_rows', [{ name: 'label', type: 'text' }]);
        expect(builder.statements.map(statement => statement.text)).toEqual([
            'create table if not exists "single_key" ("id" text not null primary key)',
            'create table if not exists "legacy_keys" ("id" text not null, "tenant" text not null, primary key ("id", "tenant"))',
            'create table if not exists "keyless_rows" ("label" text not null)',
        ]);
    });

    it('supports legacy single-key metadata and primary flags when key selectors are absent', async () => {
        const snapshot = await joinSnapshot();
        for (const selectors of [{ keyProperties: undefined }, { keyProperties: undefined, keyProperty: undefined }]) {
            const legacy = { ...snapshot, entities: snapshot.entities.map(entity => ({ ...entity, ...selectors, manyToManyRelationships: [] })) };
            const migration = diffModelSnapshots({ formatVersion: 1, entities: [] }, legacy)
                .toMigration('20261004001401_LegacyOrderedKeys', 'LegacyOrderedKeys');
            const generator = new MigrationSqlGenerator(sqliteProviderServices.migrationDialect, sqliteProviderServices.createMigrationBuilder);
            expect(generator.generateUpScript(migration)).toContain('"legacy_id" varchar(64) not null primary key');
            const operation = diffModelSnapshots({ formatVersion: 1, entities: [] }, legacy).operations[0];
            if (operation.kind !== 'createTable') throw new Error('Expected legacy table creation.');
            for (const column of operation.columns) expect(column).not.toHaveProperty('primaryKeyOrdinal');
        }
    });

    it('orders a three-column key when one column already occupies its declared position', async () => {
        const snapshot = await joinSnapshot();
        const ordered = { ...snapshot, entities: snapshot.entities.map(entity => ({ ...entity,
            keyProperty: undefined, keyProperties: ['tenant', 'id', 'label'], manyToManyRelationships: [],
            properties: entity.properties.map(property => ({ ...property, isPrimaryKey: true })),
        })) };
        const diff = diffModelSnapshots({ formatVersion: 1, entities: [] }, ordered);
        const migration = diff.toMigration('20261004001402_CreateThreePartKeys', 'CreateThreePartKeys');
        const generator = new MigrationSqlGenerator(sqliteProviderServices.migrationDialect, sqliteProviderServices.createMigrationBuilder);
        expect(generator.generateUpScript(migration)).toContain('primary key ("tenant", "legacy_id", "label")');
    });

    it.each(['missing flag', 'swapped flag', 'duplicate selector', 'missing selector'])(
        'refuses a snapshot with a %s rather than rendering an ambiguous key', async defect => {
            const snapshot = await joinSnapshot({ composite: true });
            const invalid = { ...snapshot, entities: snapshot.entities.map(entity => entity.tableName !== 'join_entries' ? entity : {
                ...entity,
                keyProperties: defect === 'duplicate selector' ? ['tenant', 'tenant'] : defect === 'missing selector' ? ['tenant'] : entity.keyProperties,
                properties: entity.properties.map(property => (defect === 'missing flag' || defect === 'swapped flag') && property.propertyName === 'id'
                    ? { ...property, isPrimaryKey: false } : defect === 'swapped flag' && property.propertyName === 'label'
                        ? { ...property, isPrimaryKey: true } : property),
            }) };
            expect(() => diffModelSnapshots({ formatVersion: 1, entities: [] }, invalid)).toThrow('Primary-key order must name every primary-key column exactly once.');
        },
    );
});

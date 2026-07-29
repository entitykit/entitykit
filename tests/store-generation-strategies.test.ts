import { ModelBuilder as ModelBuilderImplementation } from '../src/model/model-builder';
import {
    type PropertyBuilder,
    ValueGenerated,
} from '../src';
import { diffModelSnapshots, MigrationSqlGenerator } from '../src/migrations/api';
import { mySqlDialect, mySqlProviderServices } from '../src/providers/mysql';
import { postgresProviderServices } from '../src/providers/postgres';
import { sqliteProviderServices } from '../src/providers/sqlite';
import { SchemaSqlBuilder } from '../src/schema/schema-sql-builder';
import { createGeneratedModelSnapshot } from './db-pull-codegen/support';

class GeneratedNumber {
    public id!: number;
    public sequenceValue!: number;
}

class TenantGeneratedNumber {
    public id!: string;
    public tenantId!: string;
}

function generatedModel(
    configure: (property: PropertyBuilder<number>) => void,
    type = 'integer',
): ModelBuilderImplementation {
    return new ModelBuilderImplementation().entity(GeneratedNumber, entity => {
        entity.toTable('generated_numbers', 'app');
        entity.hasKey(row => row.id);
        configure(entity.property(row => row.id).hasColumnName('id').hasColumnType(type));
        entity.property(row => row.sequenceValue)
            .hasColumnName('sequence_value').hasColumnType('bigint').isRequired();
    });
}

describe('store-generation strategies', () => {
    it('models and renders provider-native generation without hidden defaults', () => {
        const postgres = generatedModel(property => property.useIdentityColumn({
            mode: 'always',
            startValue: 10n,
            incrementBy: 5,
            minValue: 10,
            maxValue: 1000n,
            isCyclic: true,
            cache: 20,
        }))
            .hasSequence('business_numbers', sequence => sequence.hasSchema('app'))
            .entity(GeneratedNumber, entity => {
                entity.property(row => row.sequenceValue)
                    .useSequence('business_numbers', 'app');
            })
            .build();
        const postgresSql = new SchemaSqlBuilder().build(postgres);

        expect(postgresSql).toContain(
            '"id" integer primary key generated always as identity (increment by 5 minvalue 10 maxvalue 1000 start with 10 cache 20 cycle)',
        );
        expect(postgresSql).toContain(
            '"sequence_value" bigint not null default nextval(\'"app"."business_numbers"\'::regclass)',
        );

        const mysql = generatedModel(property =>
            property.useAutoIncrement()).build();
        expect(new SchemaSqlBuilder(mySqlDialect).build(mysql))
            .toContain('`id` int primary key auto_increment');

        const sqlite = generatedModel(property =>
            property.useSqliteRowId({ preventReuse: true })).build();
        expect(new SchemaSqlBuilder(sqliteProviderServices.dialect).build(sqlite))
            .toContain('"id" integer primary key autoincrement');
    });

    it('supports an unsigned auto-increment column first in a composite MySQL key', () => {
        const model = new ModelBuilderImplementation()
            .entity(TenantGeneratedNumber, entity => {
                entity.toTable('tenant_generated_numbers');
                entity.hasKey(row => [row.id, row.tenantId]);
                entity.property(row => row.id)
                    .hasColumnType('bigint unsigned')
                    .useAutoIncrement();
                entity.property(row => row.tenantId)
                    .hasColumnName('tenant_id')
                    .hasColumnType('text')
                    .isRequired();
            })
            .build();

        const sql = new SchemaSqlBuilder(mySqlDialect).build(model);
        expect(sql).toContain('`id` bigint unsigned not null auto_increment');
        expect(sql).toContain('primary key (`id`, `tenant_id`)');
    });

    it('migrates an unsigned auto-increment column first in a composite MySQL key', () => {
        const builder = mySqlProviderServices.createMigrationBuilder();
        builder.createTable('tenant_widget', table => {
            table.column('id', 'bigint unsigned')
                .primaryKey()
                .generatedByAutoIncrement();
            table.column('tenant_id', 'text').primaryKey();
        }, undefined, { primaryKeyName: 'pk_tenant_widget' });

        expect(builder.statements.map(statement => statement.text)).toEqual([
            'create table if not exists `tenant_widget` (`id` bigint unsigned not null auto_increment, `tenant_id` varchar(255) collate utf8mb4_bin not null, constraint `pk_tenant_widget` primary key (`id`, `tenant_id`))',
        ]);
    });

    it('keeps strategy metadata deterministic and reversible in migrations', () => {
        const before = generatedModel(property => property.useIdentityColumn({
            mode: 'byDefault',
            startValue: 1,
        })).build().toSnapshot();
        const after = generatedModel(property => property.useIdentityColumn({
            mode: 'always',
            startValue: 100,
            incrementBy: 10,
            cache: 5,
        })).build().toSnapshot();
        const diff = diffModelSnapshots(before, after);
        const operation = diff.operations.find(item => item.kind === 'alterColumn');

        expect(operation).toMatchObject({
            column: {
                storeGeneration: {
                    kind: 'identity',
                    mode: 'always',
                    startValue: '100',
                    incrementBy: '10',
                    cache: 5,
                },
                oldStoreGeneration: {
                    kind: 'identity',
                    mode: 'byDefault',
                    startValue: '1',
                },
            },
        });

        const generator = new MigrationSqlGenerator(
            undefined,
            postgresProviderServices.createMigrationBuilder,
        );
        const migration = diff.toMigration('2_Identity', 'Identity');
        expect(generator.generateUpScript(migration)).toContain(
            'alter table "app"."generated_numbers" alter column "id" set generated always;',
        );
        expect(generator.generateUpScript(migration)).toContain(
            'alter table "app"."generated_numbers" alter column "id" set increment by 10;',
        );
        expect(generator.generateDownScript(migration)).toContain(
            'alter table "app"."generated_numbers" alter column "id" set generated by default;',
        );
    });

    it('rebuilds SQLite tables when rowid reuse semantics change', () => {
        const before = generatedModel(property =>
            property.useSqliteRowId()).build().toSnapshot();
        const after = generatedModel(property =>
            property.useSqliteRowId({ preventReuse: true }))
            .build().toSnapshot();
        const migration = diffModelSnapshots(before, after)
            .toMigration('2_RowId', 'RowId');
        const generator = new MigrationSqlGenerator(
            sqliteProviderServices.migrationDialect,
            sqliteProviderServices.createMigrationBuilder,
        );

        expect(generator.generateUpScript(migration)).toContain(
            '"id" integer primary key autoincrement',
        );
        expect(generator.generateUpScript(migration)).toContain(
            'select "id", "sequence_value" from "app"."generated_numbers"',
        );
        expect(generator.generateDownScript(migration))
            .not.toContain('autoincrement');
    });

    it('keeps generated-column renames rename-only', () => {
        const before = generatedModel(property =>
            property.useIdentityColumn()).build().toSnapshot();
        const after = {
            ...before,
            entities: before.entities.map(entity => ({
                ...entity,
                properties: entity.properties.map(property =>
                    property.columnName === 'id'
                        ? { ...property, columnName: 'generated_id' }
                        : property),
            })),
        };
        const migration = diffModelSnapshots(before, after, {
            renameHints: {
                columns: [{
                    tableName: 'generated_numbers',
                    schemaName: 'app',
                    from: 'id',
                    to: 'generated_id',
                }],
            },
        }).toMigration('2_Rename', 'Rename');
        const generator = new MigrationSqlGenerator(
            undefined,
            postgresProviderServices.createMigrationBuilder,
        );
        const sql = generator.generateUpScript(migration);

        expect(sql).toContain(
            'rename column "id" to "generated_id"',
        );
        expect(sql).not.toContain('set generated');
        expect(sql).not.toContain('drop identity');
    });

    it('rejects invalid combinations and provider mismatches early', () => {
        expect(() => generatedModel(property =>
            property.useIdentityColumn({ incrementBy: 0 })))
            .toThrow('Identity increment must not be zero');
        expect(() => generatedModel(property =>
            property.useIdentityColumn().hasDefaultSql('1')).build())
            .toThrow('cannot also configure a default');
        expect(() => generatedModel(property =>
            property.useIdentityColumn().valueGeneratedNever()).build())
            .toThrow('must remain generated on add');

        const identityText = generatedModel(
            property => property.useIdentityColumn(),
            'text',
        ).build();
        expect(() => new SchemaSqlBuilder().build(identityText))
            .toThrow('Postgres identity columns must use');

        const identity = generatedModel(property =>
            property.useIdentityColumn()).build();
        expect(() => new SchemaSqlBuilder(mySqlDialect).build(identity))
            .toThrow('not supported by the \'mysql\' provider');
        expect(identity.getEntity(GeneratedNumber).getProperty('id'))
            .toMatchObject({
                isRequired: true,
                valueGenerated: ValueGenerated.OnAdd,
            });
    });

    it('scaffolds exact identity options into compilable model code', async () => {
        const snapshot = {
            schemas: [{
                name: 'app',
                tables: [{
                    schemaName: 'app',
                    tableName: 'counters',
                    columns: [{
                        name: 'id',
                        ordinal: 1,
                        storeType: 'bigint',
                        isNullable: false,
                        isStoreGenerated: true,
                        storeGeneration: {
                            kind: 'identity' as const,
                            mode: 'always' as const,
                            startValue: '9007199254740993',
                            incrementBy: '2',
                            minValue: '1',
                            maxValue: '9999999999999999',
                            isCyclic: false,
                            cache: 8,
                        },
                    }],
                    primaryKey: { name: 'counters_pkey', columns: ['id'] },
                    indexes: [],
                    foreignKeys: [],
                }],
            }],
        };

        const modelSnapshot = await createGeneratedModelSnapshot(snapshot);
        expect(modelSnapshot.entities[0]?.properties[0]?.storeGeneration)
            .toEqual(snapshot.schemas[0].tables[0].columns[0].storeGeneration);
    });
});

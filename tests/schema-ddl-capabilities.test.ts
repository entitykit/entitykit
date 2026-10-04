import type { DbContextOptionsBuilder } from '../packages/core/src';
import type { SqlDialect } from '../packages/core/src/adapter';
import { MigrationBuilder } from '../packages/core/src/migrations/api';
import { sqliteDialect, sqliteProviderServices } from '../packages/sqlite/src';
import { MainSchemaContext, expectMainSchemaState, seedMainSchema } from './support/main-schema-support';
import { ModelBuilder } from '../packages/core/src/model/model-builder';
import { SchemaSqlBuilder } from '../packages/core/src/schema/schema-sql-builder';

describe('provider schema DDL capabilities', () => {
    it('creates a namespace used only by a sequence before emitting that sequence and unqualified tables', () => {
        class NumberedEdition {
            public id = 0;
        }
        const model = new ModelBuilder()
            .hasSequence('edition_numbers', sequence => sequence.hasSchema('counters'))
            .hasSequence('local_numbers')
            .entity(NumberedEdition, entity => {
                entity.toTable('numbered_editions');
                entity.hasKey(row => row.id);
                entity.property(row => row.id).hasColumnType('integer');
            }).build();
        const statements = new SchemaSqlBuilder().buildStatements(model);
        expect(statements[0]).toBe('create schema if not exists "counters";');
        expect(statements[1]).toContain('create sequence if not exists "counters"."edition_numbers"');
        expect(statements[2]).toContain('create sequence if not exists "local_numbers"');
        expect(statements[3]).toContain('create table if not exists "numbered_editions"');
    });

    it('creates a namespace owned only by a mapped table', () => {
        class CatalogRow {
            public id = '';
        }
        const model = new ModelBuilder().entity(CatalogRow, entity => {
            entity.toTable('catalog_rows', 'catalog');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('varchar(64)');
        }).build();
        const statements = new SchemaSqlBuilder().buildStatements(model);
        expect(statements[0]).toBe('create schema if not exists "catalog";');
        expect(statements[1]).toContain('create table if not exists "catalog"."catalog_rows"');
    });

    it('creates a join-only namespace while leaving an unqualified join table in the default namespace', () => {
        class CatalogTag {
            public id = '';
        }
        class CatalogEntry {
            public id = '';
            public tags: CatalogTag[] = [];
            public localTags: CatalogTag[] = [];
        }
        const model = new ModelBuilder().entity(CatalogEntry, entity => {
            entity.toTable('catalog_entries');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('varchar(64)');
            entity.hasManyToMany(CatalogTag, row => row.tags).usingJoinTable('edition_tags', join =>
                join.hasSchema('links').sourceForeignKey('entry_id').targetForeignKey('tag_id'));
            entity.hasManyToMany(CatalogTag, row => row.localTags).usingJoinTable('local_tags', join =>
                join.sourceForeignKey('entry_id').targetForeignKey('tag_id'));
        }).entity(CatalogTag, entity => {
            entity.toTable('catalog_tags');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('varchar(64)');
        }).build();
        const statements = new SchemaSqlBuilder().buildStatements(model);
        expect(statements[0]).toBe('create schema if not exists "links";');
        expect(statements.filter(statement => statement.startsWith('create schema'))).toHaveLength(1);
        expect(statements.join('\n')).toContain('create table if not exists "links"."edition_tags"');
        expect(statements.join('\n')).toContain('create table if not exists "local_tags"');
    });

    it('executes ordered schema statements and binds references to the owning dialect in both schema and migration builders', async () => {
        const calls: Array<{ operation: string; owner: SqlDialect }> = [];
        const dialect: SqlDialect = {
            ...sqliteDialect,
            createSchemaStatements(schemaName) {
                expect(schemaName).toBe('main');
                calls.push({ operation: 'create', owner: this });
                return ['select 1', 'select 2'];
            },
            ddlTableReference(schemaName, tableName) {
                expect(schemaName).toBe('main');
                calls.push({ operation: 'reference', owner: this });
                return this.quoteIdentifier(tableName);
            },
            dropSchemaStatement(schemaName) {
                expect(schemaName).toBe('main');
                calls.push({ operation: 'drop', owner: this });
                return 'select 3';
            },
        };
        class HookContext extends MainSchemaContext {
            protected override configure(options: DbContextOptionsBuilder): void {
                options.useProvider({ ...sqliteProviderServices, dialect }, ':memory:');
            }
        }
        const context = HookContext.create('main');
        const query = jest.spyOn(context.database.connection, 'query');
        try {
            await context.database.ensureCreated();
            expect(query.mock.calls.slice(0, 2).map(([statement]) => statement.text)).toEqual(['select 1;', 'select 2;']);
            expect(calls.filter(call => call.operation === 'create')).toHaveLength(1);
            expect(calls.filter(call => call.operation === 'reference')).toHaveLength(4);
            await seedMainSchema(context);
            await expectMainSchemaState(context);

            const builder = new MigrationBuilder(dialect);
            builder.createSchema('main');
            builder.createTable('schema_child', [{ name: 'owner', type: 'text' }], 'main', { foreignKeys: [{
                name: 'fk_child', columns: ['owner'], principalTableName: 'schema_entries', principalSchemaName: 'main',
                principalColumns: ['id'],
            }] });
            builder.createIndex({ name: 'ix_child', tableName: 'schema_child', schemaName: 'main', columns: ['owner'] });
            builder.addForeignKey({ name: 'fk_extra', tableName: 'schema_child', schemaName: 'main', columns: ['owner'],
                principalTableName: 'schema_entries', principalSchemaName: 'main', principalColumns: ['id'] });
            builder.dropSchema('main');
            expect(builder.statements.slice(0, 2).map(statement => statement.text)).toEqual(['select 1', 'select 2']);
            expect(builder.statements.at(-1)?.text).toBe('select 3');
            expect(calls.filter(call => call.operation === 'reference')).toHaveLength(7);
            expect(calls.filter(call => call.operation === 'drop')).toHaveLength(1);
            for (const call of calls) expect(call.owner).toBe(dialect);
        } finally {
            await context.dispose();
        }
    });
});

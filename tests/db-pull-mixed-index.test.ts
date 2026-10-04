import { generateDbPullCodeWithDiagnostics, type DatabaseIndexKeyPart, type DatabaseSchemaSnapshot } from '../packages/core/src/tooling';
import { contextMigrations } from '../packages/core/src/migrations/api';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { mySqlProviderServices } from '../packages/mysql/src';
import { loadGeneratedDbContext } from './support/load-generated-db-context';
import { requireDefined } from './support/require-defined';

const cases = ['sqlite', 'postgres', 'mysql'].flatMap(provider => [false, true].map(reverse => ({ provider, reverse })));

describe('db pull mixed index key identity', () => {
    it.each(cases)('preserves column and expression keys for $provider, reverse=$reverse', async ({ provider, reverse }) => {
        const expression = provider === 'mysql' ? 'lower(`Book,Title`)' : 'lower("Book,Title")';
        const parts: DatabaseIndexKeyPart[] = [{ kind: 'column', name: 'Edition Label' }, { kind: 'expression', expression }];
        if (reverse) parts.reverse();
        const snapshot: DatabaseSchemaSnapshot = { schemas: [{ name: '', tables: [{
            schemaName: '', tableName: 'book_catalog',
            columns: [
                { name: 'id', ordinal: 1, storeType: 'integer', isNullable: false },
                { name: 'Edition Label', ordinal: 2, storeType: 'varchar(64)', isNullable: true },
                { name: 'Book,Title', ordinal: 3, storeType: 'varchar(64)', isNullable: true },
            ],
            primaryKey: { name: 'pk_books', columns: ['id'] }, foreignKeys: [],
            indexes: [{ name: 'ix_book_catalog', columns: ['Edition Label'], keyParts: parts, isUnique: true }],
        }] }] };
        const contextName = 'PulledMixedBookshop';
        const generated = generateDbPullCodeWithDiagnostics(snapshot, {
            contextName, providerName: provider,
            connectionStringExpression: JSON.stringify(provider === 'sqlite' ? ':memory:' : provider === 'mysql' ? 'mysql://entitykit.invalid/entitykit' : 'postgres://entitykit.invalid/entitykit'),
        });
        expect(generated.diagnostics).toEqual([]);
        const context = await loadGeneratedDbContext(generated.files, contextName, {
            '@entitykit/sqlite': { sqliteProviderServices }, '@entitykit/mysql': { mySqlProviderServices },
        }).create();
        try {
            const model = contextMigrations(context).createModelSnapshot();
            const entity = requireDefined(model.entities[0]);
            const property = requireDefined(entity.properties.find(item => item.columnName === 'Edition Label'));
            expect(entity.indexes[0]?.keyParts).toEqual(parts.map(part => part.kind === 'column'
                ? { kind: 'property', propertyName: property.propertyName }
                : part));
            expect(entity.indexes[0]?.propertyNames).toEqual([property.propertyName]);
            expect(entity.indexes[0]?.isUnique).toBe(true);
            expect(context.database.createScript()).toContain(provider === 'mysql' ? '`Edition Label`' : '"Edition Label"');
        } finally {
            await context.dispose();
        }
    });
});

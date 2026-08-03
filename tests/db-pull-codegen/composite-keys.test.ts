import { requireDefined } from '../support/require-defined';
import { generateDbPullCode, generateDbPullCodeWithDiagnostics, type DatabaseSchemaSnapshot } from '../../src/tooling';
import { compileGeneratedFiles, createGeneratedModelSnapshot } from './support';

describe('db pull with composite keys', () => {
    const compositeSnapshot: DatabaseSchemaSnapshot = {
        schemas: [{
            name: 'app',
            tables: [
                {
                    schemaName: 'app',
                    tableName: 'order_lines',
                    columns: [
                        { name: 'order_id', ordinal: 1, storeType: 'text', isNullable: false },
                        { name: 'line_number', ordinal: 2, storeType: 'integer', isNullable: false },
                        { name: 'sku', ordinal: 3, storeType: 'text', isNullable: false },
                    ],
                    primaryKey: { name: 'pk_order_lines', columns: ['order_id', 'line_number'] },
                    indexes: [],
                    foreignKeys: [],
                },
                {
                    schemaName: 'app',
                    tableName: 'allocations',
                    columns: [
                        { name: 'id', ordinal: 1, storeType: 'text', isNullable: false },
                        { name: 'order_id', ordinal: 2, storeType: 'text', isNullable: false },
                        { name: 'line_number', ordinal: 3, storeType: 'integer', isNullable: false },
                    ],
                    primaryKey: { name: 'pk_allocations', columns: ['id'] },
                    indexes: [],
                    foreignKeys: [{
                        name: 'fk_allocations_order_lines',
                        columns: ['order_id', 'line_number'],
                        principalSchemaName: 'app',
                        principalTableName: 'order_lines',
                        principalColumns: ['order_id', 'line_number'],
                        onDelete: 'cascade',
                    }],
                },
            ],
        }],
    };

    it('generates a composite key and a multi-column foreign key', () => {
        const files = generateDbPullCode(compositeSnapshot, { contextName: 'PulledDbContext' });
        const contextFile = files.find(file => file.path === 'pulled-db-context.ts')?.contents ?? '';

        // Both keep their constraint column order.
        expect(contextFile).toContain(
            'orderLines = this.set<OrderLine, [OrderLine["orderId"], OrderLine["lineNumber"]]>(OrderLine);',
        );
        expect(contextFile).toContain('entity.hasKey(row => [row.orderId, row.lineNumber]);');
        expect(contextFile).toContain('.hasForeignKey(row => [row.orderId, row.lineNumber])');
    });

    it('reports nothing to review for a fully mapped composite schema', () => {
        const result = generateDbPullCodeWithDiagnostics(compositeSnapshot, { contextName: 'PulledDbContext' });

        expect(result.diagnostics).toEqual([]);
    });

    it('compiles the generated files', () => {
        expect(compileGeneratedFiles(compositeSnapshot)).toEqual([]);
    });

    it('round-trips into a model snapshot with both keys intact', async () => {
        const snapshot = await createGeneratedModelSnapshot(compositeSnapshot);

        const orderLine = snapshot.entities.find(entity => entity.entityName === 'OrderLine');
        expect(requireDefined(orderLine).keyProperties).toEqual(['orderId', 'lineNumber']);

        const allocation = snapshot.entities.find(entity => entity.entityName === 'Allocation');
        expect(requireDefined(allocation).relationships[0].foreignKeyProperties).toEqual(['orderId', 'lineNumber']);
    });
});

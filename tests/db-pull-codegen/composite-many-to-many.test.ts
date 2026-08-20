import { generateDbPullCode, generateDbPullCodeWithDiagnostics, type DatabaseColumn, type DatabaseIndex, type DatabaseSchemaSnapshot, type DatabaseTable } from '../../packages/core/src/tooling';
import {
    compileGeneratedFiles,
    createGeneratedModelSnapshot,
} from './support';

describe('db pull composite many-to-many discovery', () => {
    it('round-trips ordered join columns and constraint names', async () => {
        const snapshot = compositeSnapshot(compositeJoinTable(
            'pk_order_line_labels_custom',
        ));
        const files = generateDbPullCode(snapshot);
        const context = files.find(
            file => file.path === 'app-db-context.ts',
        )?.contents ?? '';
        expect(files.some(file =>
            file.path === 'order-line-label.ts')).toBe(false);
        expect(context).toContain(
            'join.primaryKeyName("pk_order_line_labels_custom");',
        );
        expect(context).toContain(
            'join.sourceForeignKey(["order_id","line_number"]);',
        );
        expect(context).toContain(
            'join.targetForeignKey(["label_namespace","label_code"]);',
        );
        expect(compileGeneratedFiles(snapshot)).toEqual([]);

        const generated = await createGeneratedModelSnapshot(snapshot);
        const relationship = generated.entities
            .flatMap(entity => entity.manyToManyRelationships ?? [])[0];
        expect(relationship).toMatchObject({
            primaryKeyName: 'pk_order_line_labels_custom',
            sourceForeignKeyColumns: ['order_id', 'line_number'],
            targetForeignKeyColumns: ['label_namespace', 'label_code'],
        });
    });

    it.each([
        {
            name: 'payload columns',
            change: (table: MutableJoinTable) => {
                table.columns.push(requiredColumn('assigned_at', 5));
            },
        },
        {
            name: 'different delete behaviors',
            change: (table: MutableJoinTable) => {
                table.foreignKeys[1].onDelete = 'restrict';
            },
        },
        {
            name: 'secondary indexes',
            change: (table: MutableJoinTable) => {
                table.indexes.push({
                    name: 'ix_join_label',
                    columns: ['label_namespace', 'label_code'],
                    isUnique: false,
                });
            },
        },
    ])('keeps candidates with $name as explicit entities', ({ change }) => {
        const join = compositeJoinTable();
        change(join);
        const result = generateDbPullCodeWithDiagnostics(
            compositeSnapshot(join),
        );
        expect(result.files.some(file =>
            file.path === 'order-line-label.ts')).toBe(true);
        expect(result.diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({ category: 'unsupported-schema' }),
        ]));
    });

    it('discovers self joins with two distinct navigations', () => {
        const snapshot: DatabaseSchemaSnapshot = {
            schemas: [{
                name: 'app',
                tables: [
                    {
                        schemaName: 'app',
                        tableName: 'nodes',
                        columns: [requiredColumn('id', 1)],
                        primaryKey: { name: 'pk_nodes', columns: ['id'] },
                        indexes: [],
                        foreignKeys: [],
                    },
                    {
                        schemaName: 'app',
                        tableName: 'node_links',
                        columns: [
                            requiredColumn('source_id', 1),
                            requiredColumn('target_id', 2),
                        ],
                        primaryKey: {
                            name: 'pk_node_links',
                            columns: ['source_id', 'target_id'],
                        },
                        indexes: [],
                        foreignKeys: [
                            foreignKey(
                                'fk_links_source',
                                ['source_id'],
                                'nodes',
                                ['id'],
                            ),
                            foreignKey(
                                'fk_links_target',
                                ['target_id'],
                                'nodes',
                                ['id'],
                            ),
                        ],
                    },
                ],
            }],
        };
        const files = generateDbPullCode(snapshot);
        const entity = files.find(
            file => file.path === 'node.ts',
        )?.contents ?? '';
        const context = files.find(
            file => file.path === 'app-db-context.ts',
        )?.contents ?? '';
        expect(files.some(file => file.path === 'node-link.ts')).toBe(false);
        expect(entity).toContain('nodes!: Node[];');
        expect(entity).toContain('nodesNavigation!: Node[];');
        expect(context).toContain(
            'entity.hasManyToMany(Node, row => row.nodes)',
        );
        expect(context).toContain('.withMany(row => row.nodesNavigation)');
        expect(compileGeneratedFiles(snapshot)).toEqual([]);
    });
});

interface MutableJoinTable {
    schemaName: string;
    tableName: string;
    columns: DatabaseColumn[];
    primaryKey: { name: string; columns: string[] };
    indexes: DatabaseIndex[];
    foreignKeys: MutableForeignKey[];
}

interface MutableForeignKey {
    name: string;
    columns: string[];
    principalSchemaName: string;
    principalTableName: string;
    principalColumns: string[];
    onDelete: string;
}

function compositeSnapshot(
    join: MutableJoinTable,
): DatabaseSchemaSnapshot {
    return {
        schemas: [{
            name: 'app',
            tables: [
                compositePrincipal(
                    'order_lines',
                    ['order_id', 'line_number'],
                ),
                compositePrincipal('labels', ['namespace', 'label_code']),
                join,
            ],
        }],
    };
}

function requiredColumn(
    name: string,
    ordinal: number,
): DatabaseColumn {
    return { name, ordinal, storeType: 'text', isNullable: false };
}

function compositePrincipal(
    tableName: string,
    keyColumns: readonly string[],
): DatabaseTable {
    return {
        schemaName: 'app',
        tableName,
        columns: keyColumns.map((column, index) =>
            requiredColumn(column, index + 1)),
        primaryKey: { name: `pk_${tableName}`, columns: keyColumns },
        indexes: [],
        foreignKeys: [],
    };
}

function compositeJoinTable(
    primaryKeyName = 'pk_order_line_labels',
): MutableJoinTable {
    return {
        schemaName: 'app',
        tableName: 'order_line_labels',
        columns: [
            requiredColumn('order_id', 1),
            requiredColumn('line_number', 2),
            requiredColumn('label_namespace', 3),
            requiredColumn('label_code', 4),
        ],
        primaryKey: {
            name: primaryKeyName,
            columns: [
                'order_id',
                'line_number',
                'label_namespace',
                'label_code',
            ],
        },
        indexes: [],
        foreignKeys: [
            foreignKey(
                'fk_join_lines',
                ['order_id', 'line_number'],
                'order_lines',
                ['order_id', 'line_number'],
            ),
            foreignKey(
                'fk_join_labels',
                ['label_namespace', 'label_code'],
                'labels',
                ['namespace', 'label_code'],
            ),
        ],
    };
}

function foreignKey(
    name: string,
    columns: string[],
    principalTableName: string,
    principalColumns: string[],
): MutableForeignKey {
    return {
        name,
        columns,
        principalSchemaName: 'app',
        principalTableName,
        principalColumns,
        onDelete: 'cascade',
    };
}

import { MigrationBuilder } from '../packages/core/src/migrations/migration-builder';
import type { ModelDiffOperation } from '../packages/core/src/migrations/model-diff-operations';
import { inlineForeignKeys, operationTableKey, planForeignKeyInlining } from '../packages/core/src/migrations/model-diff-foreign-key-inlining';

type Table = Extract<ModelDiffOperation, { kind: 'createTable' | 'dropTable' }>;
type ForeignKey = Extract<ModelDiffOperation, { kind: 'addForeignKey' | 'dropForeignKey' }>;

function table(tableName: string, kind: Table['kind'], schemaName?: string): Table {
    return { kind, entityName: tableName, tableName, schemaName, columns: [{ name: 'id', type: 'integer', primaryKey: true }] };
}

function key(tableName: string, kind: ForeignKey['kind'], schemaName?: string, name = 'fk_claim_user'): ForeignKey {
    return { kind, entityName: tableName, tableName, schemaName, name, columns: ['tenant_id', 'user_id'],
        principalTableName: 'users', principalSchemaName: 'identity', principalColumns: ['tenant_id', 'id'], onDelete: 'restrict' };
}

describe('portable migration foreign-key constraints', () => {
    it.each(['up', 'down'] as const)('preserves every constraint facet and declaration order on %s', direction => {
        const created = table('new_claims', 'createTable', 'claims');
        const removed = table('old_claims', 'dropTable', 'claims');
        const add = key('new_claims', 'addForeignKey', 'claims', 'fk_first');
        const second = { ...add, name: 'fk_second', principalTableName: 'reviewers', onDelete: 'cascade' };
        const drop = key('old_claims', 'dropForeignKey', 'claims', 'fk_old');
        const addedExisting = key('existing_claims', 'addForeignKey', 'claims');
        const removedExisting = key('existing_claims', 'dropForeignKey', 'claims');
        const operations = Object.freeze([created, removed, add, second, drop, addedExisting, removedExisting]);
        const before = JSON.stringify(operations);
        const plan = planForeignKeyInlining(operations, direction);
        const expected = direction === 'up' ? [add, second] : [drop];
        const target = direction === 'up' ? created : removed;
        expect([...plan.byTable.keys()]).toEqual([operationTableKey(target)]);
        expect(plan.byTable.get(operationTableKey(target))).toEqual(expected.map(foreignKey => ({
            name: foreignKey.name, columns: foreignKey.columns, principalTableName: foreignKey.principalTableName,
            principalSchemaName: foreignKey.principalSchemaName, principalColumns: foreignKey.principalColumns, onDelete: foreignKey.onDelete,
        })));
        expect([...plan.absorbed]).toEqual([add, second, drop]);
        expect(JSON.stringify(operations)).toBe(before);
    });

    it.each(['up', 'down'] as const)('leaves altered existing tables independent of new table absorption on %s', direction => {
        const operations = [table('unrelated', 'createTable'), table('retired', 'dropTable'),
            key('existing', 'addForeignKey'), key('existing', 'dropForeignKey')];
        const plan = planForeignKeyInlining(operations, direction);
        expect(plan.byTable.size).toBe(0);
        expect(plan.absorbed.size).toBe(0);
    });

    it.each(['up', 'down'] as const)('distinguishes dotted and quoted schema/table identities on %s', direction => {
        const createdKind = direction === 'up' ? 'createTable' : 'dropTable';
        const addKind = direction === 'up' ? 'addForeignKey' : 'dropForeignKey';
        const first = table('claims', createdKind, 'tenant.one');
        const second = table('one.claims', createdKind, 'tenant');
        const firstKey = key('claims', addKind, 'tenant.one', 'fk_first');
        const secondKey = key('one.claims', addKind, 'tenant', 'fk_second');
        const quoted = table('claim."row', createdKind, 'tenant`schema');
        const quotedKey = key('claim."row', addKind, 'tenant`schema', 'fk_quoted');
        const plan = planForeignKeyInlining([first, second, quoted, firstKey, secondKey, quotedKey], direction);
        expect(plan.byTable.size).toBe(3);
        for (const [target, expected] of [[first, firstKey], [second, secondKey], [quoted, quotedKey]] as const) {
            expect(plan.byTable.get(operationTableKey(target))?.map(foreignKey => foreignKey.name)).toEqual([expected.name]);
        }
        const isolated = planForeignKeyInlining([first, secondKey], direction);
        expect(isolated.byTable.size).toBe(0);
        expect(isolated.absorbed.size).toBe(0);
    });

    it.each(['up', 'down'] as const)('normalizes absent/default schemas but preserves explicit schemas on %s', direction => {
        const kind = direction === 'up' ? 'createTable' : 'dropTable';
        const foreignKeyKind = direction === 'up' ? 'addForeignKey' : 'dropForeignKey';
        const created = table('claims', kind);
        const matching = key('claims', foreignKeyKind, '');
        const other = key('claims', foreignKeyKind, 'elsewhere');
        const plan = planForeignKeyInlining([created, matching, other], direction);
        expect(plan.byTable.get(operationTableKey(created))).toHaveLength(1);
        expect([...plan.absorbed]).toEqual([matching]);
    });

    it.each(['up', 'down'] as const)('keeps altering providers separate while inline providers absorb constraints on %s', direction => {
        const operations = [table('claims', direction === 'up' ? 'createTable' : 'dropTable'),
            key('claims', direction === 'up' ? 'addForeignKey' : 'dropForeignKey')];
        const separate = inlineForeignKeys(new MigrationBuilder(), operations, direction);
        expect(separate.byTable.size).toBe(0);
        expect(separate.absorbed.size).toBe(0);
        const inline = inlineForeignKeys(new MigrationBuilder(undefined, { supportsAlterTableConstraints: false }), operations, direction);
        expect(inline.byTable.get(operationTableKey(operations[0]))).toHaveLength(1);
        expect([...inline.absorbed]).toEqual([operations[1]]);
    });

    it('leaves empty operation lists unchanged', () => {
        const plan = planForeignKeyInlining([], 'up');
        expect(plan.byTable.size).toBe(0);
        expect(plan.absorbed.size).toBe(0);
    });
});

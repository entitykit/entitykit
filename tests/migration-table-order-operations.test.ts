import type { ModelDiffOperation } from '../packages/core/src/migrations/model-diff-operations';
import { orderMigrationTables } from '../packages/core/src/migrations/migration-table-order';
import { reverseModelDiffOperation } from '../packages/core/src/migrations/model-diff-operation-inverse';

type Table = Extract<ModelDiffOperation, { kind: 'createTable' | 'dropTable' }>;
type ForeignKey = Extract<ModelDiffOperation, { kind: 'addForeignKey' | 'dropForeignKey' }>;

function table(tableName: string, kind: Table['kind'] = 'createTable', schemaName?: string): Table {
    return { kind, entityName: tableName, tableName, schemaName, columns: [{ name: 'id', type: 'integer', primaryKey: true }] };
}

function key(dependent: Table, principal: Table, kind: ForeignKey['kind'] = 'addForeignKey'): ForeignKey {
    return { kind, entityName: dependent.entityName, tableName: dependent.tableName, schemaName: dependent.schemaName,
        name: `fk_${dependent.tableName}_${principal.tableName}`, columns: ['parent_id'],
        principalTableName: principal.tableName, principalSchemaName: principal.schemaName, principalColumns: ['id'], onDelete: 'restrict' };
}

describe('physical migration dependency ordering', () => {
    it.each(['up', 'down'] as const)('waits for every principal while preserving unrelated operation phases on %s', direction => {
        const child = table('claim');
        const firstParent = table('user');
        const secondParent = table('reviewer');
        const unrelated = table('catalog');
        const sequence: ModelDiffOperation = { kind: 'createSequence', sequence: { name: 'claim_numbers' } };
        const index: ModelDiffOperation = { kind: 'createIndex', entityName: 'claim', tableName: 'claim', name: 'ix_claim', columns: ['id'], unique: false };
        const original = [sequence, child, unrelated, firstParent, secondParent, index,
            key(child, firstParent), key(child, secondParent), key(child, table('already_present'))];
        const input = Object.freeze(direction === 'up' ? original : original.map(reverseModelDiffOperation));
        const expectedTables = [unrelated, firstParent, secondParent, child].map(operation =>
            direction === 'up' ? operation : reverseModelDiffOperation(operation));
        const output = orderMigrationTables(input, direction);
        expect(output).toEqual([input[0], ...expectedTables, ...input.slice(5)]);
        expect(input[1]).toEqual(direction === 'up' ? child : reverseModelDiffOperation(child));
        expect(input).toHaveLength(9);
    });

    it.each(['up', 'down'] as const)('drops dependents before every principal on %s', direction => {
        const parent = table('users', 'dropTable', 'identity');
        const child = table('claims', 'dropTable', 'identity');
        const grandchild = table('tokens', 'dropTable', 'identity');
        const original = [key(child, parent, 'dropForeignKey'), key(grandchild, child, 'dropForeignKey'), parent, child, grandchild];
        const input = Object.freeze(direction === 'up' ? original : original.map(reverseModelDiffOperation));
        const output = orderMigrationTables(input, direction);
        expect(output.slice(0, 2)).toEqual(input.slice(0, 2));
        expect(output.slice(2).map(operation => 'tableName' in operation ? operation.tableName : '')).toEqual(['tokens', 'claims', 'users']);
    });

    it('preserves independent tables, self references, and caller-owned arrays', () => {
        const first = table('first');
        const second = table('second');
        const input = Object.freeze([first, second, key(first, first), key(second, table('existing'))]);
        expect(orderMigrationTables(input, 'up')).toEqual(input);
        expect(input[0]).toBe(first);
        expect(input[1]).toBe(second);
        expect(orderMigrationTables([], 'up')).toEqual([]);
    });

    it('retains every operation in a cycle and orders unrelated tables without waiting for the cycle', () => {
        const first = table('first');
        const second = table('second');
        const unrelated = table('catalog');
        const input = Object.freeze([first, second, unrelated, key(first, second), key(second, first)]);
        expect(orderMigrationTables(input, 'up')).toEqual([unrelated, first, second, input[3], input[4]]);
    });

    it('orders tables by schema and table components even when dotted names collide', () => {
        const child = table('one.claims', 'createTable', 'tenant');
        const parent = table('users', 'createTable', 'tenant.one');
        const independent = table('claims', 'createTable', 'tenant.one');
        const input = [child, independent, parent, key(child, parent)];
        expect(orderMigrationTables(input, 'up')).toEqual([independent, parent, child, input[3]]);
    });

    it('orders creations and removals independently in the same migration', () => {
        const createdParent = table('new_users');
        const createdChild = table('new_claims');
        const droppedParent = table('old_users', 'dropTable');
        const droppedChild = table('old_claims', 'dropTable');
        const input = [key(droppedChild, droppedParent, 'dropForeignKey'), createdChild, createdParent,
            key(createdChild, createdParent), droppedParent, droppedChild];
        expect(orderMigrationTables(input, 'up')).toEqual([input[0], createdParent, createdChild, input[3], droppedChild, droppedParent]);
    });

    it.each(['up', 'down'] as const)('keeps removed and replacement relationships separate for reused table names on %s', direction => {
        const user = table('users');
        const claim = table('claims');
        const oldUser = { ...user, kind: 'dropTable' as const };
        const oldClaim = { ...claim, kind: 'dropTable' as const };
        const original = [key(oldUser, oldClaim, 'dropForeignKey'), oldClaim, oldUser, claim, user, key(claim, user)];
        const input = Object.freeze(direction === 'up' ? original : original.map(reverseModelDiffOperation));
        const output = orderMigrationTables(input, direction);
        expect(output).toEqual([input[0], input[2], input[1], input[4], input[3], input[5]]);
    });
});

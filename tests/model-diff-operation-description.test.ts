import type {
    ModelDiffOperation,
} from '../src/migrations/model-diff-operations';
import {
    describeModelDiffOperation,
    isDestructiveModelDiffOperation,
} from '../src/migrations/model-diff-operation-description';

const column = { name: 'id', type: 'text' } as const;
const tableShape = {
    tableName: 'users',
    columns: [column],
    foreignKeys: [],
    checkConstraints: [],
    indexes: [],
} as const;
const joinTable = {
    entityName: 'User.roles',
    tableName: 'user_roles',
    schemaName: 'app',
    columns: [column],
    primaryKeyName: 'pk_user_roles',
    primaryKeyColumns: ['user_id', 'role_id'],
    sourceTableName: 'users',
    sourceColumnName: 'id',
    sourceForeignKeyColumn: 'user_id',
    sourceConstraintName: 'fk_user_roles_users',
    targetTableName: 'roles',
    targetColumnName: 'id',
    targetForeignKeyColumn: 'role_id',
    targetConstraintName: 'fk_user_roles_roles',
    deleteBehavior: 'cascade',
} as const;

const cases: ReadonlyArray<readonly [ModelDiffOperation, string, boolean]> = [
    [{ kind: 'createTable', entityName: 'User', tableName: 'users', schemaName: 'app', columns: [column] }, 'Create table app.users', false],
    [{ kind: 'renameTable', entityName: 'User', tableName: 'users', newTableName: 'accounts', schemaName: 'app' }, 'Rename table app.users -> app.accounts', false],
    [{ kind: 'dropTable', entityName: 'User', tableName: 'users', columns: [column] }, 'Drop table users', true],
    [{ kind: 'addColumn', entityName: 'User', tableName: 'users', schemaName: 'app', column }, 'Add column app.users.id', false],
    [{ kind: 'alterColumn', entityName: 'User', tableName: 'users', column }, 'Alter column users.id', false],
    [{ kind: 'dropColumn', entityName: 'User', tableName: 'users', schemaName: 'app', columnName: 'id', column }, 'Drop column app.users.id', true],
    [{ kind: 'createIndex', entityName: 'User', tableName: 'users', name: 'ix_users_id', columns: ['id'], unique: false }, 'Create index ix_users_id', false],
    [{ kind: 'createIndex', entityName: 'User', tableName: 'users', name: 'uq_users_id', columns: ['id'], unique: true }, 'Create unique index uq_users_id', false],
    [{ kind: 'dropIndex', entityName: 'User', tableName: 'users', name: 'ix_users_id', columns: ['id'], unique: false }, 'Drop index ix_users_id', true],
    [{ kind: 'addForeignKey', entityName: 'User', tableName: 'users', name: 'fk_users_tenant', columns: ['tenant_id'], principalTableName: 'tenants', principalColumns: ['id'], onDelete: 'cascade' }, 'Add foreign key fk_users_tenant', false],
    [{ kind: 'dropForeignKey', entityName: 'User', tableName: 'users', name: 'fk_users_tenant', columns: ['tenant_id'], principalTableName: 'tenants', principalColumns: ['id'], onDelete: 'cascade' }, 'Drop foreign key fk_users_tenant', true],
    [{ kind: 'addCheckConstraint', entityName: 'User', tableName: 'users', name: 'ck_users_id', sql: 'id <> \'\'' }, 'Add check constraint ck_users_id', false],
    [{ kind: 'dropCheckConstraint', entityName: 'User', tableName: 'users', name: 'ck_users_id', sql: 'id <> \'\'' }, 'Drop check constraint ck_users_id', false],
    [{ kind: 'createSequence', sequence: { name: 'user_id_seq', schemaName: 'app' } }, 'Create sequence app.user_id_seq', false],
    [{ kind: 'alterSequence', sequence: { name: 'user_id_seq' }, previous: { name: 'user_id_seq' } }, 'Alter sequence user_id_seq', false],
    [{ kind: 'dropSequence', sequence: { name: 'user_id_seq', schemaName: 'app' } }, 'Drop sequence app.user_id_seq', true],
    [{ kind: 'rebuildTable', entityName: 'User', tableName: 'users', schemaName: 'app', definition: { previous: tableShape, current: tableShape, copyColumns: [], reverseCopyColumns: [] } }, 'Rebuild table app.users when required by the provider', false],
    [{ kind: 'createJoinTable', ...joinTable }, 'Create join table app.user_roles', false],
    [{ kind: 'dropJoinTable', ...joinTable }, 'Drop join table app.user_roles', true],
];

describe('model diff operation descriptions', () => {
    it.each(cases)('describes $kind operations', (operation, description) => {
        expect(describeModelDiffOperation(operation)).toBe(description);
    });

    it.each(cases)('classifies $kind operations for data-loss review', (
        operation,
        _description,
        destructive,
    ) => {
        expect(isDestructiveModelDiffOperation(operation)).toBe(destructive);
    });

    it('fails loudly for an operation unknown to the installed runtime', () => {
        expect(() => describeModelDiffOperation({ kind: 'future' } as never))
            .toThrow('Unsupported model diff operation: {"kind":"future"}');
    });
});

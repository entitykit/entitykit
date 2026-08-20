import { reverseModelDiffOperation } from '../packages/core/src/migrations/model-diff-operation-inverse';
import type { MigrationTableShape } from '../packages/core/src/migrations/migration-builder';
import type { ModelDiffOperation } from '../packages/core/src/migrations/model-diff-operations';

const column = { name: 'id', type: 'text', nullable: false } as const;
const alterColumn = {
    name: 'email_address',
    oldName: 'email',
    type: 'varchar(320)',
    oldType: 'text',
    nullable: true,
    oldNullable: false,
    defaultSql: '\'unknown@example.com\'',
    oldDefaultSql: undefined,
} as const;
const tableShape = (tableName: string): MigrationTableShape => ({
    tableName,
    columns: [column],
    foreignKeys: [],
    checkConstraints: [],
    indexes: [],
});
const foreignKey = {
    entityName: 'User',
    tableName: 'users',
    name: 'fk_users_tenant',
    columns: ['tenant_id'],
    principalTableName: 'tenants',
    principalColumns: ['id'],
    onDelete: 'cascade',
} as const;
const joinTable = {
    entityName: 'User.roles',
    tableName: 'user_roles',
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

const operations: readonly ModelDiffOperation[] = [
    { kind: 'createTable', entityName: 'User', tableName: 'users', columns: [column] },
    { kind: 'dropTable', entityName: 'User', tableName: 'users', columns: [column] },
    { kind: 'renameTable', entityName: 'User', tableName: 'users', newTableName: 'accounts' },
    { kind: 'addColumn', entityName: 'User', tableName: 'users', column },
    { kind: 'dropColumn', entityName: 'User', tableName: 'users', columnName: 'id', column },
    { kind: 'alterColumn', entityName: 'User', tableName: 'users', column: alterColumn },
    { kind: 'createIndex', entityName: 'User', tableName: 'users', name: 'ix_users_id', columns: ['id'], unique: false },
    { kind: 'dropIndex', entityName: 'User', tableName: 'users', name: 'ix_users_id', columns: ['id'], unique: false },
    { kind: 'addForeignKey', ...foreignKey },
    { kind: 'dropForeignKey', ...foreignKey },
    { kind: 'addCheckConstraint', entityName: 'User', tableName: 'users', name: 'ck_users_id', sql: 'id <> \'\'' },
    { kind: 'dropCheckConstraint', entityName: 'User', tableName: 'users', name: 'ck_users_id', sql: 'id <> \'\'' },
    { kind: 'createSequence', sequence: { name: 'user_id_seq', startValue: '1' } },
    { kind: 'dropSequence', sequence: { name: 'user_id_seq', startValue: '1' } },
    { kind: 'alterSequence', sequence: { name: 'user_id_seq', startValue: '10' }, previous: { name: 'user_id_seq', startValue: '1' } },
    {
        kind: 'rebuildTable',
        entityName: 'User',
        tableName: 'users',
        definition: {
            previous: tableShape('users_old'),
            current: tableShape('users'),
            copyColumns: [{ source: 'email', target: 'email_address' }],
            reverseCopyColumns: [{ source: 'email_address', target: 'email' }],
        },
    },
    { kind: 'createJoinTable', ...joinTable },
    { kind: 'dropJoinTable', ...joinTable },
];

const inverseKinds: Record<ModelDiffOperation['kind'], ModelDiffOperation['kind']> = {
    createTable: 'dropTable',
    dropTable: 'createTable',
    renameTable: 'renameTable',
    addColumn: 'dropColumn',
    dropColumn: 'addColumn',
    alterColumn: 'alterColumn',
    createIndex: 'dropIndex',
    dropIndex: 'createIndex',
    addForeignKey: 'dropForeignKey',
    dropForeignKey: 'addForeignKey',
    addCheckConstraint: 'dropCheckConstraint',
    dropCheckConstraint: 'addCheckConstraint',
    createSequence: 'dropSequence',
    dropSequence: 'createSequence',
    alterSequence: 'alterSequence',
    rebuildTable: 'rebuildTable',
    createJoinTable: 'dropJoinTable',
    dropJoinTable: 'createJoinTable',
};

describe('model diff operation inversion', () => {
    it.each(operations)('maps $kind to its inverse without mutation', operation => {
        const inverse = reverseModelDiffOperation(operation);

        expect(inverse.kind).toBe(inverseKinds[operation.kind]);
        expect(inverse).not.toBe(operation);
    });

    it.each(operations)('round trips the serialized $kind shape', operation => {
        const roundTrip = reverseModelDiffOperation(
            reverseModelDiffOperation(operation),
        );

        expect(JSON.stringify(roundTrip)).toBe(JSON.stringify(operation));
    });

    it('fails loudly for an operation unknown to the installed runtime', () => {
        expect(() => reverseModelDiffOperation({ kind: 'future' } as never))
            .toThrow('Unsupported model diff operation: {"kind":"future"}');
    });
});

import {
    staticImportsOf,
    topLevelDeclarationNames,
} from './architecture-test-support';
import {
    testIdentifierBoundaries,
    testSizeBudgets,
} from './module-ownership-test-support';

describe('SQL module ownership', () => {
    testIdentifierBoundaries([
        {
            file: 'packages/core/src/sql/row-select-builder.ts',
            forbidden: ['ProjectionExpression'],
        },
        {
            file: 'packages/core/src/sql/joined-select-builder.ts',
            forbidden: ['ProjectionExpression'],
        },
        {
            file: 'packages/core/src/sql/select-terminal-statement.ts',
            forbidden: ['EntityMetadata', 'QueryModel'],
        },
        {
            file: 'packages/core/src/sql/relation-existence-sql-compiler.ts',
            forbidden: ['joinSchemaName', 'currentJoinColumns'],
        },
        {
            file: 'packages/core/src/sql/insert-sql-builder.ts',
            forbidden: [
                'SqlParameterBag',
                'validateRequiredProperties',
                'joinEndpointValues',
            ],
        },
        {
            file: 'packages/core/src/sql/entity-insert-sql.ts',
            forbidden: ['ManyToManyMetadata'],
        },
        {
            file: 'packages/core/src/sql/outbox-insert-sql.ts',
            forbidden: ['EntityMetadata', 'ManyToManyMetadata'],
        },
        {
            file: 'packages/core/src/sql/modification-sql-builder.ts',
            forbidden: ['typeColumn', 'occurredAtColumn'],
        },
        {
            file: 'packages/core/src/sql/modification-sql-outbox-builder.ts',
            forbidden: ['EntityMetadata', 'ManyToManyMetadata'],
        },
        {
            file: 'packages/core/src/sql/upsert-sql-builder.ts',
            forbidden: [
                'SqlParameterBag',
                'toStoreValue',
                'resolveConfiguredProperties',
            ],
        },
    ]);

    testSizeBudgets([
        {
            maximumLines: 100,
            files: [
                'packages/core/src/sql/upsert-sql-builder.ts',
                'packages/core/src/sql/batch-upsert-sql.ts',
                'packages/core/src/sql/postgres-upsert-sql.ts',
                'packages/core/src/sql/upsert-property-selection.ts',
            ],
        },
        {
            maximumLines: 110,
            files: [
                'packages/core/src/sql/insert-sql-builder.ts',
                'packages/core/src/sql/entity-insert-sql.ts',
                'packages/core/src/sql/many-to-many-insert-sql.ts',
                'packages/core/src/sql/outbox-insert-sql.ts',
            ],
        },
    ]);

    it('keeps relation-existence cache keys coupled to the many-to-many grammar', () => {
        expect(staticImportsOf('packages/core/src/sql/select/cache-key-relation.ts'))
            .toContain('packages/core/src/sql/relation-existence-many-to-many.ts');
    });

    it('keeps Postgres defaults out of the SQL dialect contract', () => {
        const declarations = topLevelDeclarationNames('packages/core/src/sql/sql-dialect.ts');

        expect(declarations.has('postgresDialect')).toBe(false);
        expect(declarations.has('quoteIdentifier')).toBe(false);
    });
});

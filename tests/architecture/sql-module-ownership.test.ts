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
            file: 'src/sql/row-select-builder.ts',
            forbidden: ['ProjectionExpression'],
        },
        {
            file: 'src/sql/joined-select-builder.ts',
            forbidden: ['ProjectionExpression'],
        },
        {
            file: 'src/sql/select-terminal-statement.ts',
            forbidden: ['EntityMetadata', 'QueryModel'],
        },
        {
            file: 'src/sql/relation-existence-sql-compiler.ts',
            forbidden: ['joinSchemaName', 'currentJoinColumns'],
        },
        {
            file: 'src/sql/insert-sql-builder.ts',
            forbidden: [
                'SqlParameterBag',
                'validateRequiredProperties',
                'joinEndpointValues',
            ],
        },
        {
            file: 'src/sql/entity-insert-sql.ts',
            forbidden: ['ManyToManyMetadata'],
        },
        {
            file: 'src/sql/outbox-insert-sql.ts',
            forbidden: ['EntityMetadata', 'ManyToManyMetadata'],
        },
        {
            file: 'src/sql/modification-sql-builder.ts',
            forbidden: ['typeColumn', 'occurredAtColumn'],
        },
        {
            file: 'src/sql/modification-sql-outbox-builder.ts',
            forbidden: ['EntityMetadata', 'ManyToManyMetadata'],
        },
        {
            file: 'src/sql/upsert-sql-builder.ts',
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
                'src/sql/upsert-sql-builder.ts',
                'src/sql/batch-upsert-sql.ts',
                'src/sql/postgres-upsert-sql.ts',
                'src/sql/upsert-property-selection.ts',
            ],
        },
        {
            maximumLines: 110,
            files: [
                'src/sql/insert-sql-builder.ts',
                'src/sql/entity-insert-sql.ts',
                'src/sql/many-to-many-insert-sql.ts',
                'src/sql/outbox-insert-sql.ts',
            ],
        },
    ]);

    it('keeps relation-existence cache keys coupled to the many-to-many grammar', () => {
        expect(staticImportsOf('src/sql/select/cache-key-relation.ts'))
            .toContain('src/sql/relation-existence-many-to-many.ts');
    });

    it('keeps Postgres defaults out of the SQL dialect contract', () => {
        const declarations = topLevelDeclarationNames('src/sql/sql-dialect.ts');

        expect(declarations.has('postgresDialect')).toBe(false);
        expect(declarations.has('quoteIdentifier')).toBe(false);
    });
});

import {
    hasNamedReExport,
    staticImportsOf,
} from './architecture-test-support';
import {
    testIdentifierBoundaries,
    testSizeBudgets,
} from './module-ownership-test-support';

describe('query module ownership', () => {
    testIdentifierBoundaries([
        {
            file: 'packages/core/src/query/queryable.ts',
            forbidden: ['whereIf', 'leftJoin'],
        },
        {
            file: 'packages/core/src/query/include-strategy-many-to-many.ts',
            forbidden: ['SqlParameterBag', 'PredicateSqlCompiler'],
        },
        {
            file: 'packages/core/src/query/include-strategy-one-to-many.ts',
            forbidden: ['SqlParameterBag', 'PredicateSqlCompiler'],
        },
        {
            file: 'packages/core/src/query/include-key-helpers.ts',
            forbidden: ['IncludeExpression'],
        },
        {
            file: 'packages/core/src/query/include-navigation-helpers.ts',
            forbidden: ['StoreValueReader', 'readStoreValue'],
        },
        {
            file: 'packages/core/src/query/aggregate-selection-expressions.ts',
            forbidden: ['dateBucketPrecisions', 'aggregateFieldSymbol'],
        },
        {
            file: 'packages/core/src/query/aggregate-field-guards.ts',
            forbidden: ['GroupedAggregateSelection'],
        },
        {
            file: 'packages/core/src/query/queryable-projected.ts',
            forbidden: ['EntityNotFoundError', 'SelectSqlBuilder', 'executeProjectionToArray'],
        },
        {
            file: 'packages/core/src/query/joined-query-projected.ts',
            forbidden: ['EntityNotFoundError', 'SelectSqlBuilder', 'executeProjectionToArray'],
        },
        {
            file: 'packages/core/src/query/projected-query-terminals.ts',
            forbidden: [
                'createQueryProxy',
                'createJoinedQueryProxy',
                'EntityNotFoundError',
                'MultipleEntitiesFoundError',
            ],
        },
        {
            file: 'packages/core/src/query/queryable-terminals.ts',
            forbidden: ['EntityNotFoundError', 'MultipleEntitiesFoundError'],
        },
        {
            file: 'packages/core/src/query/aggregate-query-terminals.ts',
            forbidden: ['EntityNotFoundError', 'MultipleEntitiesFoundError'],
        },
        {
            file: 'packages/core/src/query/unsafe-raw-sql-queryable.ts',
            forbidden: ['EntityNotFoundError', 'MultipleEntitiesFoundError'],
        },
        {
            file: 'packages/core/src/query/queryable-aggregate.ts',
            forbidden: ['EntityNotFoundError', 'SelectSqlBuilder', 'executeAggregateToArray'],
        },
        {
            file: 'packages/core/src/query/joined-query-aggregate.ts',
            forbidden: ['EntityNotFoundError', 'SelectSqlBuilder', 'executeAggregateToArray'],
        },
    ]);

    testSizeBudgets([
        {
            maximumLines: 100,
            files: [
                'packages/core/src/query/query-model-snapshot.ts',
                'packages/core/src/query/aggregate-query-terminals.ts',
                'packages/core/src/query/queryable-aggregate.ts',
                'packages/core/src/query/joined-query-aggregate.ts',
            ],
        },
        {
            maximumLines: 110,
            files: [
                'packages/core/src/query/include-loader-helpers.ts',
                'packages/core/src/query/include-key-helpers.ts',
                'packages/core/src/query/include-navigation-helpers.ts',
            ],
        },
    ]);

    it('keeps all QueryModel cloning in the snapshot owner', () => {
        const consumers = [
            'packages/core/src/query/queryable-state.ts',
            'packages/core/src/query/queryable-projected.ts',
            'packages/core/src/query/queryable-aggregate.ts',
            'packages/core/src/query/queryable-grouped.ts',
            'packages/core/src/query/joined-query/queryable-state.ts',
            'packages/core/src/query/joined-query-projected.ts',
            'packages/core/src/query/joined-query-aggregate.ts',
            'packages/core/src/query/joined-query-grouped.ts',
        ];
        const offenders = consumers.filter(file =>
            !staticImportsOf(file).includes('packages/core/src/query/query-model-snapshot.ts'),
        );

        expect(offenders).toEqual([]);
    });

    it('preserves the joined-query clone compatibility export', () => {
        expect(
            hasNamedReExport(
                'packages/core/src/query/joined-query-helpers.ts',
                'snapshotJoinedQueryModel',
                'cloneJoinedQueryModel',
            ),
        ).toBe(true);
    });
});

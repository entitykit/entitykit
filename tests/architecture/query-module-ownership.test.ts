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
            file: 'src/query/queryable.ts',
            forbidden: ['whereIf', 'leftJoin'],
        },
        {
            file: 'src/query/include-strategy-many-to-many.ts',
            forbidden: ['SqlParameterBag', 'PredicateSqlCompiler'],
        },
        {
            file: 'src/query/include-strategy-one-to-many.ts',
            forbidden: ['SqlParameterBag', 'PredicateSqlCompiler'],
        },
        {
            file: 'src/query/include-key-helpers.ts',
            forbidden: ['IncludeExpression'],
        },
        {
            file: 'src/query/include-navigation-helpers.ts',
            forbidden: ['StoreValueReader', 'readStoreValue'],
        },
        {
            file: 'src/query/aggregate-selection-expressions.ts',
            forbidden: ['dateBucketPrecisions', 'aggregateFieldSymbol'],
        },
        {
            file: 'src/query/aggregate-field-guards.ts',
            forbidden: ['GroupedAggregateSelection'],
        },
        {
            file: 'src/query/queryable-projected.ts',
            forbidden: ['EntityNotFoundError', 'SelectSqlBuilder', 'executeProjectionToArray'],
        },
        {
            file: 'src/query/joined-query-projected.ts',
            forbidden: ['EntityNotFoundError', 'SelectSqlBuilder', 'executeProjectionToArray'],
        },
        {
            file: 'src/query/projected-query-terminals.ts',
            forbidden: [
                'createQueryProxy',
                'createJoinedQueryProxy',
                'EntityNotFoundError',
                'MultipleEntitiesFoundError',
            ],
        },
        {
            file: 'src/query/queryable-terminals.ts',
            forbidden: ['EntityNotFoundError', 'MultipleEntitiesFoundError'],
        },
        {
            file: 'src/query/aggregate-query-terminals.ts',
            forbidden: ['EntityNotFoundError', 'MultipleEntitiesFoundError'],
        },
        {
            file: 'src/query/unsafe-raw-sql-queryable.ts',
            forbidden: ['EntityNotFoundError', 'MultipleEntitiesFoundError'],
        },
        {
            file: 'src/query/queryable-aggregate.ts',
            forbidden: ['EntityNotFoundError', 'SelectSqlBuilder', 'executeAggregateToArray'],
        },
        {
            file: 'src/query/joined-query-aggregate.ts',
            forbidden: ['EntityNotFoundError', 'SelectSqlBuilder', 'executeAggregateToArray'],
        },
    ]);

    testSizeBudgets([
        {
            maximumLines: 100,
            files: [
                'src/query/query-model-snapshot.ts',
                'src/query/aggregate-query-terminals.ts',
                'src/query/queryable-aggregate.ts',
                'src/query/joined-query-aggregate.ts',
            ],
        },
        {
            maximumLines: 110,
            files: [
                'src/query/include-loader-helpers.ts',
                'src/query/include-key-helpers.ts',
                'src/query/include-navigation-helpers.ts',
            ],
        },
    ]);

    it('keeps all QueryModel cloning in the snapshot owner', () => {
        const consumers = [
            'src/query/queryable-state.ts',
            'src/query/queryable-projected.ts',
            'src/query/queryable-aggregate.ts',
            'src/query/queryable-grouped.ts',
            'src/query/joined-query/queryable-state.ts',
            'src/query/joined-query-projected.ts',
            'src/query/joined-query-aggregate.ts',
            'src/query/joined-query-grouped.ts',
        ];
        const offenders = consumers.filter(file =>
            !staticImportsOf(file).includes('src/query/query-model-snapshot.ts'),
        );

        expect(offenders).toEqual([]);
    });

    it('preserves the joined-query clone compatibility export', () => {
        expect(
            hasNamedReExport(
                'src/query/joined-query-helpers.ts',
                'snapshotJoinedQueryModel',
                'cloneJoinedQueryModel',
            ),
        ).toBe(true);
    });
});

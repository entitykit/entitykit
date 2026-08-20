import {
    testIdentifierBoundaries,
    testSizeBudgets,
} from './module-ownership-test-support';

describe('introspection module ownership', () => {
    testIdentifierBoundaries([
        {
            file: 'packages/core/src/introspection/db-pull-type-mapping.ts',
            forbidden: ['numericStoreTypes', 'RegExpExecArray'],
        },
        {
            file: 'packages/core/src/introspection/db-pull-enum-type.ts',
            forbidden: ['needsReview'],
        },
        {
            file: 'packages/core/src/introspection/db-pull-store-type-classification.ts',
            forbidden: ['mapEnumType'],
        },
    ]);

    testSizeBudgets([{
        maximumLines: 100,
        files: [
            'packages/core/src/introspection/db-pull-type-mapping.ts',
            'packages/core/src/introspection/db-pull-enum-type.ts',
            'packages/core/src/introspection/db-pull-store-type-classification.ts',
        ],
    }]);
});

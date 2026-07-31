import {
    testIdentifierBoundaries,
    testSizeBudgets,
} from './module-ownership-test-support';

describe('introspection module ownership', () => {
    testIdentifierBoundaries([
        {
            file: 'src/introspection/db-pull-type-mapping.ts',
            forbidden: ['numericStoreTypes', 'RegExpExecArray'],
        },
        {
            file: 'src/introspection/db-pull-enum-type.ts',
            forbidden: ['needsReview'],
        },
        {
            file: 'src/introspection/db-pull-store-type-classification.ts',
            forbidden: ['mapEnumType'],
        },
    ]);

    testSizeBudgets([{
        maximumLines: 100,
        files: [
            'src/introspection/db-pull-type-mapping.ts',
            'src/introspection/db-pull-enum-type.ts',
            'src/introspection/db-pull-store-type-classification.ts',
        ],
    }]);
});

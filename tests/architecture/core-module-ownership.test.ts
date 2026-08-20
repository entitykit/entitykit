import {
    hasInstanceOfExpression,
    hasStaticMethodCall,
} from './architecture-test-support';
import {
    testIdentifierBoundaries,
    testSizeBudgets,
} from './module-ownership-test-support';

describe('core module ownership', () => {
    testIdentifierBoundaries([
        {
            file: 'packages/core/src/core/many-to-many-change-set.ts',
            forbidden: ['DbValidationError', 'EntityState'],
        },
        {
            file: 'packages/core/src/core/db-set-query-runner.ts',
            forbidden: ['SelectSqlBuilder', 'readStoreValue'],
        },
        {
            file: 'packages/core/src/core/save-time-writes.ts',
            forbidden: ['DbValidationError', 'EntityState'],
        },
        {
            file: 'packages/core/src/tracking/entity-entry-snapshot.ts',
            forbidden: ['navigationEntry', 'EntityState'],
        },
        {
            file: 'packages/core/src/core/db-set-query-builder.ts',
            forbidden: ['EntityNotFoundError', 'OrderExpression'],
        },
        {
            file: 'packages/core/src/core/db-set-query-refinements.ts',
            forbidden: ['EntityNotFoundError'],
        },
        {
            file: 'packages/testing/src/recording-database-connection.ts',
            forbidden: ['transactionDepth', 'sessionDepth', 'nextTransaction'],
        },
        {
            file: 'packages/testing/src/recording-transaction.ts',
            forbidden: ['SqlStatement', 'queuedResults'],
        },
        {
            file: 'packages/testing/src/recording-session.ts',
            forbidden: ['savepoint'],
        },
    ]);

    testSizeBudgets([{
        maximumLines: 125,
        files: [
            'packages/core/src/tracking/entity-entry.ts',
            'packages/core/src/tracking/entity-entry-snapshot.ts',
            'packages/testing/src/recording-database-connection.ts',
            'packages/testing/src/recorded-database-operation.ts',
            'packages/testing/src/recording-transaction.ts',
            'packages/testing/src/recording-session.ts',
        ],
    }]);

    it('keeps snapshot value mechanics out of EntityEntry coordination', () => {
        const entityEntry = 'packages/core/src/tracking/entity-entry.ts';

        expect(hasInstanceOfExpression(entityEntry, 'Date')).toBe(false);
        expect(hasStaticMethodCall(entityEntry, 'Object', 'entries')).toBe(false);
    });
});

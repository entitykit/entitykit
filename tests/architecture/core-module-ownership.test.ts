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
            file: 'src/core/many-to-many-change-set.ts',
            forbidden: ['DbValidationError', 'EntityState'],
        },
        {
            file: 'src/core/db-set-query-runner.ts',
            forbidden: ['SelectSqlBuilder', 'readStoreValue'],
        },
        {
            file: 'src/core/save-time-writes.ts',
            forbidden: ['DbValidationError', 'EntityState'],
        },
        {
            file: 'src/tracking/entity-entry-snapshot.ts',
            forbidden: ['navigationEntry', 'EntityState'],
        },
        {
            file: 'src/core/db-set-query-builder.ts',
            forbidden: ['EntityNotFoundError', 'OrderExpression'],
        },
        {
            file: 'src/core/db-set-query-refinements.ts',
            forbidden: ['EntityNotFoundError'],
        },
        {
            file: 'src/testing/recording-database-connection.ts',
            forbidden: ['transactionDepth', 'sessionDepth', 'nextTransaction'],
        },
        {
            file: 'src/testing/recording-transaction.ts',
            forbidden: ['SqlStatement', 'queuedResults'],
        },
        {
            file: 'src/testing/recording-session.ts',
            forbidden: ['savepoint'],
        },
    ]);

    testSizeBudgets([{
        maximumLines: 125,
        files: [
            'src/tracking/entity-entry.ts',
            'src/tracking/entity-entry-snapshot.ts',
            'src/testing/recording-database-connection.ts',
            'src/testing/recorded-database-operation.ts',
            'src/testing/recording-transaction.ts',
            'src/testing/recording-session.ts',
        ],
    }]);

    it('keeps snapshot value mechanics out of EntityEntry coordination', () => {
        const entityEntry = 'src/tracking/entity-entry.ts';

        expect(hasInstanceOfExpression(entityEntry, 'Date')).toBe(false);
        expect(hasStaticMethodCall(entityEntry, 'Object', 'entries')).toBe(false);
    });
});

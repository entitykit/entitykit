import { testIdentifierBoundaries } from './module-ownership-test-support';

describe('provider module ownership', () => {
    testIdentifierBoundaries([
        {
            file: 'packages/postgres/src/pg-database-connection.ts',
            forbidden: [
                'createPostgresPool',
                'createPostgresProviderError',
                'ownedPool',
            ],
        },
        {
            file: 'packages/mysql/src/mysql-database-connection.ts',
            forbidden: [
                'createMysqlPool',
                'createMysqlProviderError',
                'ownedPool',
            ],
        },
    ]);
});

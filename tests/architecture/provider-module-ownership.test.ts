import { testIdentifierBoundaries } from './module-ownership-test-support';

describe('provider module ownership', () => {
    testIdentifierBoundaries([
        {
            file: 'src/providers/postgres/pg-database-connection.ts',
            forbidden: [
                'createPostgresPool',
                'createPostgresProviderError',
                'ownedPool',
            ],
        },
        {
            file: 'src/providers/mysql/mysql-database-connection.ts',
            forbidden: [
                'createMysqlPool',
                'createMysqlProviderError',
                'ownedPool',
            ],
        },
    ]);
});

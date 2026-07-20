import { MigrationBuilder } from '../../migrations/migration-builder';
import {
    postgresMigrationDialect,
} from '../../migrations/migration-sql-dialect';
import { postgresDialect } from '../../sql/sql-dialect';
import type { DatabaseConnection } from '../../storage/database-connection';
import type { UseConnectionOptions } from './db-context-option-types';
import type { ProviderSelection } from './provider-selection';

export function registerConnection(
    selection: ProviderSelection,
    connection: DatabaseConnection,
    options: UseConnectionOptions,
): void {
    const ownership: unknown = options.ownership;
    if (
        ownership !== undefined
        && ownership !== 'context'
        && ownership !== 'external'
    ) {
        throw new Error(
            'Connection ownership must be \'context\' or \'external\'.',
        );
    }
    const dialect = options.dialect ?? postgresDialect;
    const migrationDialect =
        options.migrationDialect
        ?? postgresMigrationDialect;
    const providerName = options.provider ?? 'custom';
    const migrationBuilder =
        options.createMigrationBuilder
        ?? (() => new MigrationBuilder(dialect, {
            providerName,
            supportsConcurrentIndexes: dialect === postgresDialect,
            supportsExtensions: dialect === postgresDialect,
        }));
    selection.useConnection(
        connection,
        { provider: providerName },
        dialect,
        migrationDialect,
        migrationBuilder,
        options.valueReader,
        ownership !== 'external',
    );
}

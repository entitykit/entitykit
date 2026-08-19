import {
    MigrationBuilder,
} from './migration-builder';
import type { MigrationBuilderFactory } from './migration-builder-contract';
import {
    postgresMigrationDialect,
    type MigrationSqlDialect,
} from './migration-sql-dialect';

export function resolveMigrationBuilderFactory(
    dialect: MigrationSqlDialect,
    createBuilder?: MigrationBuilderFactory,
): MigrationBuilderFactory {
    if (createBuilder) {
        return createBuilder;
    }

    if (dialect === postgresMigrationDialect) {
        return () => new MigrationBuilder(dialect.sql, {
            providerName: 'postgres',
            supportsConcurrentIndexes: true,
            supportsExtensions: true,
        });
    }

    return () => new MigrationBuilder(dialect.sql, {
        providerName: dialect.name,
    });
}

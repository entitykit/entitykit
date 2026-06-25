import type { DatabaseRuntimeProviderServices } from './database-provider-services';
import type { DatabaseDataSource } from './database-data-source';

export function validateProviderServices<TConfig extends object>(
    provider: DatabaseRuntimeProviderServices<TConfig>,
): void {
    const candidate: unknown = provider;
    const services = (
        candidate !== null && typeof candidate === 'object'
            ? candidate
            : {}
    ) as Partial<DatabaseRuntimeProviderServices<TConfig>>;
    const providerName = services.name ?? 'database';
    if (typeof services.name !== 'string' || services.name.trim().length === 0) {
        throw new Error('Database provider must supply a non-empty name.');
    }
    if (!services.dialect) {
        throw new Error(
            `Database provider '${providerName}' must supply a runtime SQL dialect.`,
        );
    }
    if (!services.migrationDialect) {
        throw new Error(
            `Database provider '${providerName}' must supply a migration SQL dialect.`,
        );
    }
    if (typeof services.createMigrationBuilder !== 'function') {
        throw new Error(
            `Database provider '${providerName}' must supply a migration builder factory.`,
        );
    }
    if (typeof services.createConnection !== 'function') {
        throw new Error(
            `Database provider '${providerName}' must supply a connection factory.`,
        );
    }
    if (
        'createDataSource' in services
        && services.createDataSource !== undefined
        && typeof services.createDataSource !== 'function'
    ) {
        throw new Error(
            `Database provider '${providerName}' createDataSource must be a function.`,
        );
    }
    if (
        services.isTransientError !== undefined
        && typeof services.isTransientError !== 'function'
    ) {
        throw new Error(
            `Database provider '${providerName}' isTransientError must be a function.`,
        );
    }
    if (
        'createSchemaIntrospector' in services
        && services.createSchemaIntrospector !== undefined
        && typeof services.createSchemaIntrospector !== 'function'
    ) {
        throw new Error(
            `Database provider '${providerName}' createSchemaIntrospector must be a function.`,
        );
    }
    if (
        services.valueReader !== undefined
        && typeof services.valueReader.readValue !== 'function'
    ) {
        throw new Error(
            `Database provider '${providerName}' valueReader must supply readValue().`,
        );
    }
}

export function validateDatabaseDataSource(dataSource: DatabaseDataSource): void {
    const candidate: unknown = dataSource;
    const source = (
        candidate !== null && typeof candidate === 'object'
            ? candidate
            : {}
    ) as Partial<DatabaseDataSource>;
    if (
        typeof source.providerName !== 'string'
        || source.providerName.trim().length === 0
    ) {
        throw new Error('Database data source must supply a non-empty provider name.');
    }
    if (!source.dialect) {
        throw new Error(
            `Database data source '${source.providerName}' must supply a runtime SQL dialect.`,
        );
    }
    if (!source.migrationDialect) {
        throw new Error(
            `Database data source '${source.providerName}' must supply a migration SQL dialect.`,
        );
    }
    if (typeof source.createMigrationBuilder !== 'function') {
        throw new Error(
            `Database data source '${source.providerName}' must supply a migration builder factory.`,
        );
    }
    if (typeof source.createConnection !== 'function') {
        throw new Error(
            `Database data source '${source.providerName}' must supply a connection factory.`,
        );
    }
}

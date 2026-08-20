export interface ProviderConfiguration {
    readonly importLine?: string;
    readonly configureLine: string;
}

/**
 * How the generated context wires the provider it was pulled from. Postgres has
 * a built-in convenience method; the other adapters are configured through
 * `useProvider` with the services imported from their package. An unknown or
 * absent provider falls back to Postgres.
 */
export function renderProviderConfiguration(
    providerName: string | undefined,
    connectionStringExpression: string,
): ProviderConfiguration {
    switch (providerName) {
        case 'sqlite':
            return {
                importLine:
          'import { sqliteProviderServices } from "@entitykit/sqlite";',
                configureLine:
          `options.useProvider(sqliteProviderServices, ${connectionStringExpression});`,
            };
        case 'mysql':
            return {
                importLine:
          'import { mySqlProviderServices } from "@entitykit/mysql";',
                configureLine:
          `options.useProvider(mySqlProviderServices, ${connectionStringExpression});`,
            };
        case 'postgres':
        case undefined:
        default:
            return {
                configureLine:
          `options.usePostgres(${connectionStringExpression});`,
            };
    }
}

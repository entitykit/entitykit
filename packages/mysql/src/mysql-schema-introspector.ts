import type {
    DatabaseSchemaIntrospectionOptions,
    DatabaseSchemaSnapshot,
} from '@entitykit/core/adapter';
import type { DatabaseConnection } from '@entitykit/core/adapter';
import {
    queryBaseTables,
    queryCheckConstraints,
    queryColumns,
    queryForeignKeys,
    queryStatistics,
} from './mysql-introspect-queries';
import { buildSnapshot } from './mysql-introspect-snapshot';

/** Options that configure my sql schema introspection. */ export type MySqlSchemaIntrospectionOptions = DatabaseSchemaIntrospectionOptions;
export type {
    DatabaseColumn,
    DatabaseForeignKey,
    DatabaseIndex,
    DatabasePrimaryKey,
    DatabaseSchema,
    DatabaseSchemaSnapshot,
    DatabaseTable,
} from '@entitykit/core/adapter';

/**
 * Introspect a MySQL database into the provider-neutral schema snapshot.
 *
 * MySQL has no schema layer distinct from the database, so the connection's
 * current database is the unit of introspection and its tables are reported
 * unqualified (an empty `schemaName`). Reporting the database name as a schema
 * would make `db pull` generate a model whose `createSchemaScript()` runs
 * `create schema` — which in MySQL *creates a database* named after wherever
 * the schema was pulled from. Tables read from a *different* database keep that
 * database as their `schemaName`, which MySQL qualifies validly as `db.table`.
 */
export class MySqlSchemaIntrospector {
    constructor(private readonly database: DatabaseConnection) {}

    /** Perform the introspect operation. */ public async introspect(options: MySqlSchemaIntrospectionOptions = {}): Promise<DatabaseSchemaSnapshot> {
        const currentDatabase = await this.currentDatabase();
        const hasExplicitSchemas = Boolean(options.schemas && options.schemas.length > 0);
        if (!currentDatabase && !hasExplicitSchemas) {
            // Without this the queries match nothing and db pull returns an empty
            // snapshot with no hint that the connection simply selected no database.
            throw new Error('MySQL introspection needs a database: the connection has none selected. Add it to the connection string or pass { schemas }.');
        }
        const databases = hasExplicitSchemas
            ? Array.from(new Set(options.schemas ?? []))
            : [currentDatabase];

        const tableRows = await queryBaseTables(this.database, databases);
        const columns = await queryColumns(this.database, databases);
        const statistics = await queryStatistics(this.database, databases);
        const foreignKeys = await queryForeignKeys(this.database, databases);
        const checks = await queryCheckConstraints(this.database, databases);

        return buildSnapshot(
            tableRows,
            columns,
            statistics,
            foreignKeys,
            currentDatabase,
            checks,
        );
    }

    private async currentDatabase(): Promise<string> {
        const result = await this.database.query<{ db: string | null }>({
            text: 'select database() as db',
            values: [],
        });
        return result.rows[0]?.db ?? '';
    }
}

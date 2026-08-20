import type { DatabaseConnection } from '@entitykit/core/adapter';
import type {
    DatabaseColumn,
    DatabasePrimaryKey,
    DatabaseSchemaIntrospectionOptions,
    DatabaseSchemaSnapshot,
    DatabaseTable,
} from '@entitykit/core/adapter';
import { introspectSqliteColumns } from './sqlite-introspection-columns';
import { introspectSqliteForeignKeys } from './sqlite-introspection-foreign-keys';
import { introspectSqliteIndexes } from './sqlite-introspection-indexes';
import { parseSqliteTableSql } from './sqlite-ddl-parser';

/** Options that configure sqlite schema introspection. */ export type SqliteSchemaIntrospectionOptions = DatabaseSchemaIntrospectionOptions;

/** SQLite exposes a single implicit schema; attached databases are out of scope. */
const SQLITE_SCHEMA_NAME = 'main';

/**
 * The schema name reported for `main`: empty. SQLite has no `create schema` and
 * `main` is the implicit default database, so a pulled model must stay
 * unqualified or its `createSchemaScript()` would emit `create schema "main"` —
 * which SQLite rejects — and could never recreate itself. Mirrors how the MySQL
 * introspector reports the connection's own database.
 */
const REPORTED_SCHEMA_NAME = '';

/** EntityKit implementation of sqlite schema introspector. */ export class SqliteSchemaIntrospector {
    constructor(private readonly database: DatabaseConnection) {}

    /** Perform the introspect operation. */ public async introspect(options: SqliteSchemaIntrospectionOptions = {}): Promise<DatabaseSchemaSnapshot> {
        if (options.schemas && !options.schemas.some(schema => schema === SQLITE_SCHEMA_NAME || schema === REPORTED_SCHEMA_NAME)) {
            return { schemas: [] };
        }

        const objects = (await this.database.query<{
            name: string;
            type: 'table' | 'view';
            sql: string | null;
        }>({
            text: 'select name, type, sql from sqlite_master where type in (\'table\', \'view\') and name not like \'sqlite_%\' order by name',
            values: [],
        })).rows;

        // Resolve columns and primary keys first so foreign keys can fill in
        // implicit references to a target table's primary key.
        const columnsByTable: Map<string, DatabaseColumn[]> = new Map();
        const primaryKeyByTable: Map<string, DatabasePrimaryKey | undefined> = new Map();
        for (const object of objects) {
            const { columns, primaryKey } = await introspectSqliteColumns(
                this.database,
                object.name,
                object.sql ?? undefined,
            );
            columnsByTable.set(object.name, columns);
            primaryKeyByTable.set(object.name, primaryKey);
        }

        const tables: DatabaseTable[] = [];
        for (const object of objects) {
            const tableName = object.name;
            const isView = object.type === 'view';
            tables.push({
                schemaName: REPORTED_SCHEMA_NAME,
                tableName,
                objectType: isView ? 'view' : 'table',
                columns: columnsByTable.get(tableName) ?? [],
                primaryKey: primaryKeyByTable.get(tableName),
                indexes: isView ? [] : await introspectSqliteIndexes(this.database, tableName),
                foreignKeys: isView ? [] : await introspectSqliteForeignKeys(
                    this.database,
                    tableName,
                    primaryKeyByTable,
                    REPORTED_SCHEMA_NAME,
                ),
                checkConstraints: parseSqliteTableSql(object.sql ?? undefined).checks,
            });
        }

        if (tables.length === 0) {
            return { schemas: [] };
        }

        return { schemas: [{ name: REPORTED_SCHEMA_NAME, tables }] };
    }
}

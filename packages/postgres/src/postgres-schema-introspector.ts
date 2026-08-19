import type { DatabaseConnection } from '../../storage/database-connection';
import type {
    DatabaseSchemaIntrospectionOptions,
    DatabaseSchemaSnapshot,
} from '../../introspection/database-schema';
import {
    queryColumns,
    queryForeignKeys,
    queryPrimaryKeys,
} from './postgres-introspect-queries';
import { queryIndexes } from './postgres-introspect-index-query';
import {
    queryCheckConstraints,
    querySequences,
} from './postgres-introspect-schema-queries';
import { buildPostgresSchemaSnapshot } from './postgres-schema-snapshot';

/** Options that configure postgres schema introspection. */ export type PostgresSchemaIntrospectionOptions = DatabaseSchemaIntrospectionOptions;
export type {
    DatabaseColumn,
    DatabaseForeignKey,
    DatabaseIndex,
    DatabasePrimaryKey,
    DatabaseSchema,
    DatabaseSchemaSnapshot,
    DatabaseTable,
} from '../../introspection/database-schema';

/** EntityKit implementation of postgres schema introspector. */ export class PostgresSchemaIntrospector {
    constructor(private readonly database: DatabaseConnection) {}

    /** Perform the introspect operation. */ public async introspect(options: PostgresSchemaIntrospectionOptions = {}): Promise<DatabaseSchemaSnapshot> {
        const schemas = options.schemas ?? ['public'];
        const columns = await queryColumns(this.database, schemas);
        const primaryKeys = await queryPrimaryKeys(this.database, schemas);
        const indexes = await queryIndexes(this.database, schemas);
        const foreignKeys = await queryForeignKeys(this.database, schemas);
        const checks = await queryCheckConstraints(this.database, schemas);
        const sequences = await querySequences(this.database, schemas);

        return buildPostgresSchemaSnapshot(
            columns,
            primaryKeys,
            indexes,
            foreignKeys,
            checks,
            sequences,
        );
    }
}

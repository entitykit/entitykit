import type { DatabaseSchemaSnapshot, DatabaseTable } from '../../packages/core/src/tooling';

export function schemaObjects(
    snapshot: DatabaseSchemaSnapshot,
    tableNames?: readonly string[],
): DatabaseSchemaSnapshot {
    if (!tableNames) {
        return snapshot;
    }
    const included = new Set(tableNames);
    return {
        schemas: snapshot.schemas
            .map(schema => ({
                ...schema,
                tables: schema.tables.filter(table =>
                    included.has(table.tableName)),
            }))
            .filter(schema => schema.tables.length > 0),
    };
}

export function richSchemaShape(snapshot: DatabaseSchemaSnapshot): unknown {
    return snapshot.schemas.map(schema => ({
        name: schema.name,
        sequences: schema.sequences?.map(sequence => ({ ...sequence })),
        tables: schema.tables.map(tableShape),
    }));
}

function tableShape(table: DatabaseTable): unknown {
    return {
        schemaName: table.schemaName,
        tableName: table.tableName,
        objectType: table.objectType ?? 'table',
        columns: table.columns.map(column => ({
            ...column,
            defaultSql: normalizeSql(column.defaultSql),
            generatedExpression: normalizeSql(column.generatedExpression),
        })),
        primaryKey: table.primaryKey
            ? { columns: table.primaryKey.columns }
            : undefined,
        indexes: table.indexes.map(index => ({
            ...index,
            keyParts: index.keyParts?.map(part => part.kind === 'expression'
                ? { ...part, expression: normalizeSql(part.expression) }
                : part),
            filter: normalizeSql(index.filter),
        })),
        foreignKeys: table.foreignKeys,
        checkConstraints: table.checkConstraints?.map(check => ({
            ...check,
            sql: normalizeSql(check.sql),
        })),
    };
}

function normalizeSql(sql: string | undefined): string | undefined {
    return sql?.replace(/\s+/g, ' ').trim();
}

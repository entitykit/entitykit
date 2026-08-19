/**
 * Formatting, identifier-uniqueness and navigation-naming helpers shared by the
 * db-pull emitters. They are collected in one leaf so the entity emitter, the
 * model-configuration emitter, the diagnostics collector and the shape builder
 * all describe tables/columns and derive collision-free names identically — the
 * generated code and warnings must match byte-for-byte regardless of which
 * section produced them.
 */
import type {
    DatabaseColumn,
    DatabaseForeignKey,
    DatabaseIndex,
    DatabaseTable,
} from './database-schema';
import type { EntityShape } from './db-pull-codegen-types';
import { singularize, toCamelIdentifier } from './db-pull-naming';

export function tableKey(schemaName: string, tableName: string): string {
    return `${schemaName}.${tableName}`;
}

export function countIdentifiers(values: readonly string[]): Map<string, number> {
    const counts: Map<string, number> = new Map();
    for (const value of values) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return counts;
}

export function makeUniqueIdentifier(preferred: string, used: Map<string, number>): string {
    const count = used.get(preferred) ?? 0;
    used.set(preferred, count + 1);
    return count === 0 ? preferred : `${preferred}${String(count + 1)}`;
}

export function describeForeignKeyTarget(foreignKey: DatabaseForeignKey): string {
    return `${JSON.stringify(foreignKey.principalSchemaName)}.${JSON.stringify(foreignKey.principalTableName)}`;
}

export function describeTable(table: DatabaseTable): string {
    return `${JSON.stringify(table.schemaName)}.${JSON.stringify(table.tableName)}`;
}

export function describeColumn(table: DatabaseTable, column: DatabaseColumn): string {
    return `${describeTable(table)}.${JSON.stringify(column.name)}`;
}

export function formatSkippedIndexMessage(
    table: DatabaseTable,
    index: DatabaseIndex,
    unmappedColumns: readonly string[],
): string {
    if (index.unsupportedFeatures?.length) {
        return `Index '${index.name}' on ${describeTable(table)} uses unsupported ${index.unsupportedFeatures.join(', ')} metadata; generated starter skipped this index rather than changing its semantics.`;
    }
    if (unmappedColumns.length === 0) {
        return `Index '${index.name}' on ${describeTable(table)} has no mapped columns; generated starter skipped this index. Review expression or provider-specific index metadata manually.`;
    }

    return `Index '${index.name}' on ${describeTable(table)} references column(s) ${unmappedColumns.join(', ')} that were not mapped to generated properties; generated starter skipped this index.`;
}

function navigationName(foreignKey: DatabaseForeignKey): string {
    const firstColumn = foreignKey.columns[0] ?? foreignKey.principalTableName;
    const withoutId = firstColumn.replace(/_?id$/i, '');
    return toCamelIdentifier(withoutId || singularize(foreignKey.principalTableName));
}

export function createForeignKeyNavigationNames(entity: EntityShape): Map<DatabaseForeignKey, string> {
    const used = createPropertyNameUsage(entity);
    const names: Map<DatabaseForeignKey, string> = new Map();
    for (const foreignKey of entity.table.foreignKeys) {
        names.set(foreignKey, makeUniqueNavigationName(navigationName(foreignKey), used));
    }
    return names;
}

export function createNavigationNameUsage(entity: EntityShape): Set<string> {
    const used = createPropertyNameUsage(entity);
    for (const foreignKey of entity.table.foreignKeys) {
        makeUniqueNavigationName(navigationName(foreignKey), used);
    }
    return used;
}

function createPropertyNameUsage(entity: EntityShape): Set<string> {
    return new Set(entity.propertiesByColumn.values());
}

export function makeUniqueNavigationName(preferred: string, used: Set<string>): string {
    if (!used.has(preferred)) {
        used.add(preferred);
        return preferred;
    }

    const base = `${preferred}Navigation`;
    if (!used.has(base)) {
        used.add(base);
        return base;
    }

    let suffix = 2;
    while (used.has(`${base}${String(suffix)}`)) {
        suffix += 1;
    }
    const result = `${base}${String(suffix)}`;
    used.add(result);
    return result;
}

/**
 * The mapped properties behind a foreign key's columns, in constraint order, or
 * `undefined` when any column has no mapped property.
 */
export function foreignKeyPropertiesFor(entity: EntityShape, foreignKey: DatabaseForeignKey): string[] | undefined {
    if (foreignKey.columns.length === 0) {
        return undefined;
    }

    const properties = foreignKey.columns.map(column => entity.propertiesByColumn.get(column));
    return properties.every((property): property is string => Boolean(property)) ? properties : undefined;
}

/** Whether a many-to-many candidate targets the principal primary key. */
export function foreignKeyTargetsPrimaryKey(
    foreignKey: DatabaseForeignKey,
    principal: EntityShape,
): boolean {
    const primaryKeyColumns = principal.table.primaryKey?.columns;
    return (
        foreignKey.principalColumns.length === primaryKeyColumns?.length &&
        foreignKey.principalColumns.every(
            (column, index) => column === primaryKeyColumns[index],
        )
    );
}

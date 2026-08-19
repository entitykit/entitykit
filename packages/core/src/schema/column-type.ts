import type { PropertyMetadata } from '../model/property-metadata';
import type { SqlDialect } from '../sql/sql-dialect';

export function buildColumnType(
    property: PropertyMetadata,
    isKey: boolean,
    dialect: SqlDialect,
): string {
    const base = buildBaseColumnType(property);
    return dialect.mapColumnType?.(base, {
        isKey,
        collation: property.collation,
    }) ?? base;
}

function buildBaseColumnType(property: PropertyMetadata): string {
    if (!property.maxLength) {
        return property.columnType;
    }

    const normalized = property.columnType.toLowerCase();
    if (normalized.includes('(')) {
        return property.columnType;
    }

    if (
        normalized === 'text'
    || normalized === 'varchar'
    || normalized === 'character varying'
    ) {
        return `varchar(${String(property.maxLength)})`;
    }

    return `${property.columnType}(${String(property.maxLength)})`;
}

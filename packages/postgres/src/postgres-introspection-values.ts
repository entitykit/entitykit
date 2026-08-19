import type { ColumnRow } from './postgres-introspect-queries';

export function normalizePostgresStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map(String);
    }

    if (typeof value === 'string') {
        return value
            .replace(/^\{|\}$/g, '')
            .split(',')
            .filter(Boolean);
    }

    return [];
}

export function normalizePostgresBoolean(value: unknown): boolean {
    return (
        value === true ||
    value === 't' ||
    value === 'true' ||
    value === 'YES' ||
    value === 'yes' ||
    value === '1'
    );
}

export function renderPostgresStoreType(column: ColumnRow): string {
    if (column.data_type === 'ARRAY') {
        return `${renderArrayElementStoreType(column.udt_name)}[]`;
    }

    if (column.data_type === 'USER-DEFINED') {
        return column.udt_name;
    }

    if (
        column.character_maximum_length !== null &&
    ['character varying', 'varchar'].includes(column.data_type)
    ) {
        return `varchar(${String(Number(column.character_maximum_length))})`;
    }

    if (
        column.numeric_precision !== null &&
    column.numeric_scale !== null &&
    Number(column.numeric_scale) > 0
    ) {
        return (
            `${column.data_type}(` +
      `${String(Number(column.numeric_precision))},${String(Number(column.numeric_scale))})`
        );
    }

    return column.data_type;
}

function renderArrayElementStoreType(udtName: string): string {
    const elementName = udtName.startsWith('_')
        ? udtName.slice(1)
        : udtName;
    return postgresArrayElementAliases.get(elementName) ?? elementName;
}

const postgresArrayElementAliases = new Map([
    ['bpchar', 'character'],
    ['bool', 'boolean'],
    ['float4', 'real'],
    ['float8', 'double precision'],
    ['int2', 'smallint'],
    ['int4', 'integer'],
    ['int8', 'bigint'],
    ['timestamptz', 'timestamp with time zone'],
    ['timetz', 'time with time zone'],
    ['varchar', 'varchar'],
]);

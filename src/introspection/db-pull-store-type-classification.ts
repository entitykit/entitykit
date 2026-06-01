export function isNumericStoreType(normalized: string): boolean {
    return numericStoreTypes.has(baseTypeName(normalized));
}

export function isPrecisionSensitiveNumericStoreType(
    normalized: string,
): boolean {
    return precisionSensitiveNumericStoreTypes.has(baseTypeName(normalized));
}

export function isBinaryStoreType(normalized: string): boolean {
    return binaryStoreTypes.has(baseTypeName(normalized));
}

/**
 * Drop display width / precision and MySQL unsigned / zerofill modifiers.
 */
function baseTypeName(normalized: string): string {
    return normalized
        .replace(/\(.*$/, '')
        .replace(/\s+(unsigned|zerofill)\b/g, '')
        .trim();
}

const numericStoreTypes = new Set([
    'bigserial',
    'double',
    'double precision',
    'float',
    'int',
    'integer',
    'mediumint',
    'real',
    'serial',
    'smallint',
    'tinyint',
    'year',
]);

const precisionSensitiveNumericStoreTypes = new Set([
    'bigint',
    'decimal',
    'numeric',
]);

const binaryStoreTypes = new Set([
    'binary',
    'blob',
    'bytea',
    'longblob',
    'mediumblob',
    'tinyblob',
    'varbinary',
]);

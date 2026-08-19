import type { SqlDialect } from '../sql/sql-dialect';

export function renderMigrationScriptLiteral(
    value: unknown,
    dialect: SqlDialect,
): string {
    if (value === null) {
        return 'null';
    }
    if (typeof value === 'string') {
        return quoted(value, dialect);
    }
    if (typeof value === 'boolean') {
        return dialect.name === 'sqlite' ? value ? '1' : '0' : String(value);
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw unsupportedValue(value);
        }
        return String(value);
    }
    if (typeof value === 'bigint') {
        return value.toString();
    }
    if (value instanceof Date) {
        return dateLiteral(value, dialect);
    }
    if (value instanceof Uint8Array) {
        return binaryLiteral(value, dialect);
    }
    if (typeof value === 'object') {
        return jsonLiteral(value, dialect);
    }
    throw unsupportedValue(value);
}

function dateLiteral(value: Date, dialect: SqlDialect): string {
    if (!Number.isFinite(value.getTime())) {
        throw unsupportedValue(value);
    }
    const iso = value.toISOString();
    return quoted(
        dialect.name === 'mysql'
            ? `${iso.slice(0, 10)} ${iso.slice(11, 23)}`
            : iso,
        dialect,
    );
}

function binaryLiteral(value: Uint8Array, dialect: SqlDialect): string {
    const hex = [...value]
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
    if (dialect.name === 'postgres') {
        return `decode('${hex}', 'hex')`;
    }
    if (dialect.name === 'sqlite' || dialect.name === 'mysql') {
        return `X'${hex}'`;
    }
    throw unsupportedValue(value);
}

function jsonLiteral(value: object, dialect: SqlDialect): string {
    try {
        const json: unknown = JSON.stringify(value);
        if (typeof json === 'string') {
            return quoted(json, dialect);
        }
    } catch {
        throw unsupportedValue(value);
    }
    throw unsupportedValue(value);
}

function quoted(value: string, dialect: SqlDialect): string {
    if (value.includes('\0')) {
        if (dialect.name === 'postgres') {
            throw new Error(
                'Migration scripts cannot render strings containing a zero byte for Postgres.',
            );
        }
        if (dialect.name === 'sqlite') {
            return `CAST(X'${utf8Hex(value)}' AS TEXT)`;
        }
    }
    const mysqlEscapeCharacters = [
        '\0',
        '\b',
        '\t',
        '\n',
        '\r',
        String.fromCharCode(26),
        '\\',
    ];
    if (
        dialect.name === 'mysql' &&
        mysqlEscapeCharacters.some(character => value.includes(character))
    ) {
        return `CONVERT(X'${utf8Hex(value)}' USING utf8mb4)`;
    }
    return `'${value.replace(/'/g, '\'\'')}'`;
}

function utf8Hex(value: string): string {
    return [...new TextEncoder().encode(value)]
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
}

function unsupportedValue(value: unknown): Error {
    const kind = value instanceof Date
        ? 'invalid Date'
        : value instanceof Uint8Array
            ? 'binary data for this dialect'
            : typeof value;
    return new Error(
        `Migration scripts cannot render unsupported value type '${kind}'.`,
    );
}

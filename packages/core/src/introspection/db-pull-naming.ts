/**
 * Identifier naming for db pull: turn database table and column names into
 * valid, idiomatic TypeScript class, set, and property identifiers.
 */
export function singularize(value: string): string {
    if (value.endsWith('ies')) {
        return `${value.slice(0, -3)}y`;
    }
    if (value.endsWith('ses')) {
        return value.slice(0, -2);
    }
    if (value.endsWith('s') && value.length > 1) {
        return value.slice(0, -1);
    }
    return value;
}

const reservedTypeScriptIdentifiers = new Set([
    'abstract',
    'any',
    'as',
    'async',
    'await',
    'bigint',
    'boolean',
    'break',
    'case',
    'catch',
    'class',
    'const',
    'constructor',
    'continue',
    'debugger',
    'declare',
    'default',
    'delete',
    'do',
    'else',
    'enum',
    'export',
    'extends',
    'false',
    'finally',
    'for',
    'from',
    'function',
    'get',
    'if',
    'implements',
    'import',
    'in',
    'infer',
    'instanceof',
    'interface',
    'keyof',
    'let',
    'module',
    'namespace',
    'never',
    'new',
    'null',
    'number',
    'object',
    'package',
    'private',
    'protected',
    'public',
    'readonly',
    'require',
    'return',
    'set',
    'static',
    'string',
    'super',
    'switch',
    'symbol',
    'this',
    'throw',
    'true',
    'try',
    'type',
    'typeof',
    'undefined',
    'unique',
    'unknown',
    'var',
    'void',
    'while',
    'with',
    'yield',
]);

export function toPascalIdentifier(value: string): string {
    const parts = identifierParts(value);
    const result = parts.map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
    return makeSafeIdentifier(/^[a-zA-Z_$]/.test(result) ? result : `_${result || 'Entity'}`);
}

export function toCamelIdentifier(value: string): string {
    const parts = identifierParts(value);
    const result = parts.map((part, index) => {
        const lower = part.charAt(0).toLowerCase() + part.slice(1);
        return index === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1);
    }).join('');
    return makeSafeIdentifier(/^[a-zA-Z_$]/.test(result) ? result : `_${result || 'value'}`);
}

export function toKebabFileStem(value: string): string {
    const stem = value
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/_+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
    return stem || 'entity';
}

function identifierParts(value: string): string[] {
    return value.split(/[^a-zA-Z0-9]+/).filter(Boolean);
}

function makeSafeIdentifier(value: string): string {
    return reservedTypeScriptIdentifiers.has(value) ? `_${value}` : value;
}

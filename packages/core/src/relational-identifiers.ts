/** The tightest identifier limit every provider shares (Postgres is 63). */
const MAX_IDENTIFIER_LENGTH = 63;

/** Shorten a provider identifier deterministically without silent truncation. */
export function boundedIdentifier(name: string): string {
    if (Buffer.byteLength(name, 'utf8') <= MAX_IDENTIFIER_LENGTH) {
        return name;
    }
    const suffix = `_${identifierHash(name)}`;
    const budget = MAX_IDENTIFIER_LENGTH - suffix.length;
    let prefix = name;
    while (Buffer.byteLength(prefix, 'utf8') > budget) {
        prefix = prefix.slice(0, -1);
    }
    return `${prefix}${suffix}`;
}

/** Resolve a configured or conventional foreign-key constraint name. */
export function foreignKeyConstraintName(
    configured: string | undefined,
    childTable: string,
    principalTable: string,
    foreignKeyColumns: readonly string[],
): string {
    return boundedIdentifier(configured ??
        `fk_${childTable}_${principalTable}_${foreignKeyColumns.join('_')}`);
}

/** The conventional foreign-key constraint identifier. */
export function defaultForeignKeyName(
    childTable: string,
    principalTable: string,
    foreignKeyColumns: readonly string[],
): string {
    return foreignKeyConstraintName(
        undefined, childTable, principalTable, foreignKeyColumns,
    );
}

/** The conventional index identifier. */
export function defaultIndexName(
    isUnique: boolean,
    table: string,
    columns: readonly string[],
): string {
    return boundedIdentifier(
        `${isUnique ? 'ux' : 'ix'}_${table}_${columns.join('_')}`,
    );
}

function identifierHash(value: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

/** The tightest identifier limit every provider shares (Postgres is 63, MySQL 64). */
const MAX_IDENTIFIER_LENGTH = 63;

/**
 * Keep a generated identifier within every provider's limit. Postgres silently
 * truncates a name past 63 bytes — which can collide two long names into one —
 * and MySQL rejects a name past 64 outright, so a long name is shortened
 * deterministically with a hash of the full name (collision-resistant, not a
 * guarantee). The limit is bytes, not characters, since that is what Postgres
 * measures.
 *
 * Shared so the schema builder and the migration differ shorten a given name to
 * the same result: a table created with `createSchemaScript()` and one evolved
 * through migrations must agree on their constraint names.
 */
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

/**
 * The default name for a foreign key: `fk_<child table>_<principal table>_<columns>`.
 * Shared so the schema builder (which creates the constraint) and the migration
 * differ (which later references it) agree — a name they computed differently
 * would make a migration try to drop a constraint that does not exist under that
 * name. `db pull` reads this name back from the database.
 */
export function defaultForeignKeyName(
    childTable: string,
    principalTable: string,
    foreignKeyColumns: readonly string[],
): string {
    return boundedIdentifier(`fk_${childTable}_${principalTable}_${foreignKeyColumns.join('_')}`);
}

/** The default name for an index: `ix_<table>_<columns>` (or `ux_` when unique). */
export function defaultIndexName(isUnique: boolean, table: string, columns: readonly string[]): string {
    return boundedIdentifier(`${isUnique ? 'ux' : 'ix'}_${table}_${columns.join('_')}`);
}

function identifierHash(value: string): string {
    // FNV-1a (32-bit) rendered as 8 hex chars: deterministic and dependency-free.
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

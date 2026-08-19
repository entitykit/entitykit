/**
 * Translate a model's declared column type into a MySQL type.
 *
 * The model speaks in provider-neutral types — `text`, `timestamptz`, `jsonb`,
 * `boolean` — that Postgres accepts directly and SQLite ignores. MySQL accepts
 * none of the first three, and cannot key or index a `text` column without a
 * prefix length. So they are mapped here.
 *
 * String columns get `utf8mb4_bin` so comparison is case- and byte-exact,
 * matching Postgres's `LIKE` and SQLite's `pragma case_sensitive_like`. MySQL's
 * default collation is case-insensitive, which would make `like('a%')` match
 * `'Alpha'` where the other providers do not.
 */
export function mapMysqlColumnType(
    type: string,
    options: { readonly isKey: boolean; readonly collation?: string },
): string {
    const normalized = type.trim().toLowerCase();
    const base = normalized.includes('(')
        ? normalized.slice(0, normalized.indexOf('(')).trim()
        : normalized;
    const argument = normalized.includes('(')
        ? normalized.slice(normalized.indexOf('('))
        : '';

    const caseSensitive = options.collation ? '' : ' collate utf8mb4_bin';

    switch (base) {
        case 'text':
        case 'character varying':
        case 'varchar':
            // A keyed text column must be bounded; MySQL cannot index unbounded text
            // without a prefix. Others keep `text` so bodies are not truncated.
            if (base === 'varchar' || options.isKey) {
                const length = argument || '(255)';
                return `varchar${length}${caseSensitive}`;
            }
            return `text${caseSensitive}`;
        case 'char':
            return `char${argument || '(1)'}${caseSensitive}`;
        case 'timestamptz':
        case 'timestamp with time zone':
        case 'timestamp':
        case 'datetime':
            // DATETIME(3) stores a wall-clock instant to milliseconds. The connection
            // runs in UTC, so a JavaScript Date round-trips without a timezone guess.
            return 'datetime(3)';
        case 'jsonb':
        case 'json':
            return 'json';
        case 'boolean':
        case 'bool':
            return 'tinyint(1)';
        case 'integer':
        case 'int4':
            return 'int';
        case 'int8':
        case 'bigint':
            return 'bigint';
        case 'double precision':
        case 'double':
            return 'double';
        case 'uuid':
            // No native UUID; store as fixed-width text so it can be a key.
            return `char(36)${caseSensitive}`;
        default:
            return normalized;
    }
}

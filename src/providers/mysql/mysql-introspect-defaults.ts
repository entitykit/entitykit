/**
 * Normalize a column's `information_schema` default into regenerable SQL.
 *
 * MySQL reports a string literal's default *unquoted* and an expression default
 * as raw SQL, unlike Postgres and SQLite. This reconciles both so a pulled
 * model's `default ...` round-trips as a literal instead of being read back as
 * an identifier reference the server would reject.
 */

/** Column types whose literal default `information_schema` returns unquoted. */
const stringDefaultTypes = new Set([
    'char', 'varchar', 'text', 'tinytext', 'mediumtext', 'longtext', 'enum', 'set',
]);

export function normalizeDefault(value: string | null, columnType: string, extra: string | null): string | undefined {
    if (value === null) {
        return undefined;
    }
    // An expression default (MySQL 8 marks it DEFAULT_GENERATED in `extra`) is
    // already valid SQL — CURRENT_TIMESTAMP, (json_array()), and the like.
    if (extra?.toLowerCase().includes('default_generated')) {
        return value;
    }
    // MySQL returns a string literal's default *unquoted* (`active`, not
    // `'active'`), unlike Postgres and SQLite. Quote it so the regenerated
    // `default '...'` is a literal, not an identifier reference the server rejects.
    const base = columnType.includes('(') ? columnType.slice(0, columnType.indexOf('(')) : columnType;
    if (stringDefaultTypes.has(base.trim().toLowerCase())) {
        return `'${value.replace(/'/g, '\'\'')}'`;
    }
    return value;
}

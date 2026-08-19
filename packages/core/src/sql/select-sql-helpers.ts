import type { EntityMetadata } from '../model/entity-metadata';
import type { BinaryOperator } from '../query/expression/predicate-node';
import type { JoinExpression } from '../query/query-model';

/**
 * Small helpers shared by the select compiler and its aggregate sub-builder:
 * the joined-source metadata lookup and the binary-operator rendering both
 * paths need. Kept here so neither owns the other.
 */

export function createSourceMetadataMap<TEntity extends object>(
    rootMetadata: EntityMetadata<TEntity>,
    joins: readonly JoinExpression[],
): ReadonlyMap<string, EntityMetadata> {
    const sources: Map<string, EntityMetadata> = new Map();
    sources.set('root', rootMetadata as unknown as EntityMetadata);
    for (const join of joins) {
        sources.set(join.alias, join.metadata);
    }
    return sources;
}

export function normalizeSourceAlias(sourceAlias: string | undefined): string {
    return sourceAlias ?? 'root';
}

export function metadataForSource(
    sourceMetadata: ReadonlyMap<string, EntityMetadata>,
    sourceAlias: string,
): EntityMetadata {
    const metadata = sourceMetadata.get(sourceAlias);
    if (!metadata) {
        throw new Error(`Joined query source '${sourceAlias}' has not been joined.`);
    }
    return metadata;
}

export function sqlBinaryOperator(operator: BinaryOperator): string {
    switch (operator) {
        case 'eq':
            return '=';
        case 'ne':
            return '<>';
        case 'gt':
            return '>';
        case 'gte':
            return '>=';
        case 'lt':
            return '<';
        case 'lte':
            return '<=';
        case 'like':
        case 'contains':
        case 'startsWith':
        case 'endsWith':
            return 'like';
        case 'in':
            return 'in';
        default:
            return assertNever(operator);
    }
}

// `contains`/`startsWith`/`endsWith` build their own `like` pattern by wrapping
// the search term in `%`, so a literal `%` or `_` the caller typed must be
// escaped or it acts as a wildcard and silently over-matches. `~` is the escape
// character rather than the conventional `\` because the `escape '...'` clause
// is literal SQL, and `\` is not portable there: MySQL string-escapes a
// backslash in a literal, so `escape '\'` would need `'\\'` on MySQL alone,
// while `escape '~'` is the same one character on Postgres, SQLite, and MySQL.
const likeEscapeCharacter = '~';

function escapeLikeLiteral(value: string): string {
    // Escape the escape character first, then the two wildcards.
    return value
        .split(likeEscapeCharacter).join(`${likeEscapeCharacter}${likeEscapeCharacter}`)
        .split('%').join(`${likeEscapeCharacter}%`)
        .split('_').join(`${likeEscapeCharacter}_`);
}

export function stringPatternValue(operator: BinaryOperator, value: unknown): unknown {
    if (operator === 'contains') {
        return `%${escapeLikeLiteral(String(value))}%`;
    }

    if (operator === 'startsWith') {
        return `${escapeLikeLiteral(String(value))}%`;
    }

    if (operator === 'endsWith') {
        return `%${escapeLikeLiteral(String(value))}`;
    }

    return value;
}

/**
 * The ` escape '~'` suffix for the operators whose `like` pattern we build, so a
 * `%`/`_` escaped by {@link stringPatternValue} is matched literally. Empty for
 * the raw `like` operator (the caller owns its wildcards) and every non-`like`
 * operator. SQLite has no default escape character, so the clause is required,
 * not optional, for a portable literal match.
 */
export function likeEscapeClause(operator: BinaryOperator): string {
    if (operator === 'contains' || operator === 'startsWith' || operator === 'endsWith') {
        return ` escape '${likeEscapeCharacter}'`;
    }
    return '';
}

export function assertNever(value: never): never {
    throw new Error(`Unsupported query shape: ${JSON.stringify(value)}`);
}

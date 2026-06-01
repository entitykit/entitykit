/**
 * Quote a MySQL identifier with backticks, doubling embedded backticks.
 */
export function quoteMysqlIdentifier(identifier: string): string {
    if (!identifier || identifier.trim().length === 0) {
        throw new Error('SQL identifier cannot be empty.');
    }

    return `\`${identifier.replace(/`/g, '``')}\``;
}

export function quoteMysqlQualifiedIdentifier(
    ...identifiers: ReadonlyArray<string | undefined>
): string {
    const parts = identifiers.filter(
        (identifier): identifier is string =>
            identifier !== undefined && identifier.length > 0,
    );
    if (parts.length === 0) {
        throw new Error('SQL identifier cannot be empty.');
    }

    return parts.map(quoteMysqlIdentifier).join('.');
}

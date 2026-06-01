export interface MySqlIndexFeatureEntry {
    readonly column: string | null;
    readonly expression: string | null;
    readonly subPart: number | string | null;
    readonly collation: 'A' | 'D' | null;
}

export function mysqlIndexUnsupportedFeatures(
    entries: readonly MySqlIndexFeatureEntry[],
    indexType: string | undefined,
): string[] | undefined {
    const features = [
        entries.some(entry => entry.subPart !== null)
            ? 'column prefix length' : undefined,
        entries.some(entry => entry.column === null && !entry.expression)
            ? 'expression' : undefined,
        entries.some(entry => entry.collation === 'D')
            ? 'descending key order' : undefined,
        indexType !== undefined && indexType.toUpperCase() !== 'BTREE'
            ? `index type '${indexType}'` : undefined,
    ].filter((feature): feature is string => feature !== undefined);
    return features.length > 0 ? features : undefined;
}

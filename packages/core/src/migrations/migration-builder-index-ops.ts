import type { MigrationBuilderCore } from './migration-builder-core';
import type { MigrationDropIndexOptions, MigrationIndexDefinition } from './migration-builder-types';

/**
 * WHY: DDL for indexes — create, drop, and rename. Kept separate from the
 * constraint module because indexes have their own capability concerns
 * (`supportsConcurrentIndexes`, `supportsRenameIndex`) and dialect hooks
 * (existence guards, provider drop-index SQL, transaction suppression for
 * concurrent builds). `MigrationBuilder` delegates its index methods here.
 */

/**
 * Add an index operation.
 */
export function createIndex(core: MigrationBuilderCore, index: MigrationIndexDefinition): void {
    const keyParts = index.keyParts ?? index.columns.map(name => ({
        kind: 'column' as const,
        name,
    }));
    if (keyParts.length === 0) {
        throw new Error('createIndex requires at least one column or expression.');
    }
    if (index.concurrently) {
        core.assertCapability(
            core.supportsConcurrentIndexes,
            'createIndex(concurrently)',
            'Implement concurrent index DDL in the provider migration builder, use builder.sql(..., { suppressTransaction: true }) with provider-specific SQL, or remove concurrently.',
        );
    }

    const unique = index.unique ? 'unique ' : '';
    const concurrently = index.concurrently ? ' concurrently' : '';
    const existenceGuard = core.dialect.createIndexExistenceGuard?.() ?? 'if not exists ';
    const columns = keyParts.map(part => part.kind === 'column'
        ? core.dialect.quoteIdentifier(part.name)
        : core.dialect.indexExpression?.(part.expression) ?? part.expression).join(', ');
    const included = index.includedColumns?.map(column =>
        core.dialect.quoteIdentifier(column)) ?? [];
    const includeClause = included.length === 0
        ? ''
        : core.dialect.indexIncludeClause?.(included);
    core.assertCapability(
        includeClause !== undefined,
        'createIndex(include)',
        'Remove included columns or use reviewed provider-specific SQL.',
    );
    const filterClause = index.filter === undefined
        ? ''
        : core.dialect.indexFilterClause?.(index.filter);
    core.assertCapability(
        filterClause !== undefined,
        'createIndex(filter)',
        'Remove the filter or use reviewed provider-specific SQL.',
    );
    core.emitDdl(
        `create ${unique}index${concurrently} ${existenceGuard}${core.dialect.quoteIdentifier(index.name)} on ${core.dialect.quoteQualifiedIdentifier(index.schemaName, index.tableName)} (${columns})${String(includeClause)}${String(filterClause)}`,
        { suppressTransaction: index.concurrently },
    );
}

export function dropIndex(core: MigrationBuilderCore, indexName: string, schemaName?: string, options: MigrationDropIndexOptions = {}): void {
    const concurrently = options.concurrently ?? false;
    if (concurrently) {
        core.assertCapability(
            core.supportsConcurrentIndexes,
            'dropIndex(concurrently)',
            'Implement concurrent index DDL in the provider migration builder, use builder.sql(..., { suppressTransaction: true }) with provider-specific SQL, or remove concurrently.',
        );
    }
    const quotedIndex = core.dialect.quoteQualifiedIdentifier(schemaName, indexName);
    const quotedTable = options.tableName ? core.dialect.quoteQualifiedIdentifier(schemaName, options.tableName) : undefined;
    const provided = core.dialect.dropIndexStatement?.(quotedIndex, quotedTable, concurrently);
    if (provided !== undefined) {
        core.emitDdl(provided, { suppressTransaction: concurrently });
        return;
    }
    const concurrentlySql = concurrently ? ' concurrently' : '';
    core.emitDdl(`drop index${concurrentlySql} if exists ${quotedIndex}`, { suppressTransaction: concurrently });
}

export function renameIndex(core: MigrationBuilderCore, indexName: string, newIndexName: string, schemaName?: string): void {
    core.assertCapability(
        core.supportsRenameIndex,
        'renameIndex',
        'Drop and recreate the index instead (MySQL renames an index only with `alter table ... rename index`, which needs the table name; SQLite has no index rename).',
    );
    core.emitDdl(`alter index ${core.dialect.quoteQualifiedIdentifier(schemaName, indexName)} rename to ${core.dialect.quoteIdentifier(newIndexName)}`);
}

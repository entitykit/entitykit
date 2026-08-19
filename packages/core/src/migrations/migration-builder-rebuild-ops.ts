import { boundedIdentifier } from '../sql/identifiers';
import type { MigrationBuilderCore } from './migration-builder-core';
import * as IndexOps from './migration-builder-index-ops';
import type { MigrationTableRebuildDefinition } from './migration-builder-types';
import {
    createTable,
    dropTable,
    renameTable,
} from './migration-builder-table-ops';

/** Recreate a table while copying every surviving non-generated column. */
export function rebuildTable(
    core: MigrationBuilderCore,
    definition: MigrationTableRebuildDefinition,
): void {
    core.assertCapability(
        core.requiresTableRebuild,
        'rebuildTable',
        'This provider can alter the modeled table facets in place.',
    );
    const target = definition.current;
    const temporaryName = boundedIdentifier(`__entitykit_new_${target.tableName}`);
    core.emitDdl('pragma defer_foreign_keys = on');
    createTable(core, temporaryName, target.columns, target.schemaName, {
        foreignKeys: target.foreignKeys,
        checkConstraints: target.checkConstraints,
    }, false);
    copyTableRows(core, definition, temporaryName);
    dropTable(core, definition.previous.tableName, definition.previous.schemaName);
    renameTable(core, temporaryName, target.tableName, target.schemaName);
    for (const index of target.indexes) {
        IndexOps.createIndex(core, {
            ...index,
            tableName: target.tableName,
            schemaName: target.schemaName,
        });
    }
}

function copyTableRows(
    core: MigrationBuilderCore,
    definition: MigrationTableRebuildDefinition,
    temporaryName: string,
): void {
    if (definition.copyColumns.length === 0) {
        throw new Error(
            `Cannot rebuild table '${definition.current.tableName}' because no existing non-generated columns can preserve its rows.`,
        );
    }
    const targets = definition.copyColumns.map(column =>
        core.dialect.quoteIdentifier(column.target)).join(', ');
    const sources = definition.copyColumns.map(column =>
        core.dialect.quoteIdentifier(column.source)).join(', ');
    core.emitDdl(
        `insert into ${core.dialect.quoteQualifiedIdentifier(definition.current.schemaName, temporaryName)} (${targets}) select ${sources} from ${core.dialect.quoteQualifiedIdentifier(definition.previous.schemaName, definition.previous.tableName)}`,
    );
}

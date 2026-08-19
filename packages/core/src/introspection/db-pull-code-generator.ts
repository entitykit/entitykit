/**
 * Orchestrates db-pull code generation: builds the entity model, emits one file
 * per entity plus the DbContext file, and gathers diagnostics. The per-section
 * emitters live in sibling `DbPull*` modules; this file composes them and
 * re-exports the frozen public API surface.
 */
import type { DatabaseSchemaSnapshot } from './database-schema';
import type {
    DbPullCodegenOptions,
    DbPullCodegenResult,
    EntityShape,
    GeneratedCodeFile,
} from './db-pull-codegen-types';
import {
    toKebabFileStem,
    toPascalIdentifier,
} from './db-pull-naming';
import { makeUniqueIdentifier, tableKey } from './db-pull-emit-helpers';
import { createEntityShapes } from './db-pull-entity-model';
import { detectManyToManyJoinTables } from './db-pull-many-to-many-model';
import { renderEntityFile } from './db-pull-entity-emitter';
import { renderContextFile } from './db-pull-model-config-emitter';
import { collectDbPullDiagnostics } from './db-pull-diagnostics';

export type {
    DbPullCodegenOptions,
    DbPullCodegenResult,
    DbPullDiagnostic,
    GeneratedCodeFile,
} from './db-pull-codegen-types';

/** Perform the generate db pull code operation. */ export function generateDbPullCode(
    snapshot: DatabaseSchemaSnapshot,
    options: DbPullCodegenOptions = {},
): GeneratedCodeFile[] {
    return generateDbPullCodeWithDiagnostics(snapshot, options).files.slice();
}

/** Perform the generate db pull code with diagnostics operation. */ export function generateDbPullCodeWithDiagnostics(
    snapshot: DatabaseSchemaSnapshot,
    options: DbPullCodegenOptions = {},
): DbPullCodegenResult {
    const tables = snapshot.schemas.flatMap(schema => schema.tables);
    const sequences = snapshot.schemas.flatMap(schema => schema.sequences ?? []);
    const allEntities = createEntityShapes(tables);
    const allEntitiesByTable = new Map(allEntities.map(entity => [tableKey(entity.table.schemaName, entity.table.tableName), entity]));
    const manyToManyJoins = detectManyToManyJoinTables(tables, allEntitiesByTable);
    const manyToManyJoinKeys = new Set(manyToManyJoins.map(join => tableKey(join.joinTable.schemaName, join.joinTable.tableName)));
    const entities = allEntities.filter(entity => !manyToManyJoinKeys.has(tableKey(entity.table.schemaName, entity.table.tableName)));
    const contextName = createContextName(options.contextName, entities);
    const entityByTable = new Map(entities.map(entity => [tableKey(entity.table.schemaName, entity.table.tableName), entity]));
    const files: GeneratedCodeFile[] = [];

    for (const entity of entities) {
        files.push({
            path: `${toKebabFileStem(entity.className)}.ts`,
            contents: renderEntityFile(entity, entityByTable, manyToManyJoins),
        });
    }

    files.push({
        path: `${toKebabFileStem(contextName)}.ts`,
        contents: renderContextFile(
            contextName,
            entities,
            entityByTable,
            manyToManyJoins,
            sequences,
            options,
        ),
    });

    return {
        files,
        diagnostics: collectDbPullDiagnostics(options, contextName, entities, entityByTable),
    };
}

function createContextName(contextName: string | undefined, entities: readonly EntityShape[]): string {
    const usedClassNames = new Map(entities.map(entity => [entity.className, 1]));
    return makeUniqueIdentifier(toPascalIdentifier(contextName ?? 'AppDbContext'), usedClassNames);
}

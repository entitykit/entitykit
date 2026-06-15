/**
 * Turns introspected tables into the intermediate `EntityShape` /
 * `ManyToManyJoinShape` model the emitters consume: collision-free class, set
 * and property names, plus detection of pure many-to-many join tables. Kept
 * separate from emission because "which entities exist and how are they named"
 * is a distinct decision from "what source text do we print", and the
 * diagnostics collector reuses the join-review heuristic defined here.
 */
import type { DatabaseTable, DatabaseColumn } from './database-schema';
import type { EntityShape } from './db-pull-codegen-types';
import { singularize, toCamelIdentifier, toPascalIdentifier } from './db-pull-naming';
import {
    countIdentifiers,
    makeUniqueIdentifier,
} from './db-pull-emit-helpers';

export function createEntityShapes(tables: readonly DatabaseTable[]): EntityShape[] {
    const candidates = tables.map(table => {
        const className = toPascalIdentifier(singularize(table.tableName));
        const setName = toCamelIdentifier(table.tableName);
        return { table, className, setName };
    });
    const classCounts = countIdentifiers(candidates.map(candidate => candidate.className));
    const setCounts = countIdentifiers(candidates.map(candidate => candidate.setName));
    const usedClassNames: Map<string, number> = new Map();
    const usedSetNames: Map<string, number> = new Map();

    return candidates.map(candidate => {
        const className = makeUniqueIdentifier(
            (classCounts.get(candidate.className) ?? 0) > 1
                ? `${toPascalIdentifier(candidate.table.schemaName)}${candidate.className}`
                : candidate.className,
            usedClassNames,
        );
        const setName = makeUniqueIdentifier(
            (setCounts.get(candidate.setName) ?? 0) > 1
                ? `${toCamelIdentifier(candidate.table.schemaName)}${candidate.setName.charAt(0).toUpperCase()}${candidate.setName.slice(1)}`
                : candidate.setName,
            usedSetNames,
        );
        return createEntityShape(candidate.table, className, setName);
    });
}

function createEntityShape(table: DatabaseTable, className: string, setName: string): EntityShape {
    const propertiesByColumn = createPropertyIdentifiers(table.columns);
    return {
        table,
        className,
        setName,
        propertiesByColumn,
    };
}

function createPropertyIdentifiers(columns: readonly DatabaseColumn[]): ReadonlyMap<string, string> {
    const used: Map<string, number> = new Map();
    return new Map(columns.map(column => [column.name, makeUniqueIdentifier(toCamelIdentifier(column.name), used)]));
}

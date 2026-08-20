/**
 * Emits one generated entity-class file: property declarations, foreign-key and
 * many-to-many navigation members, the `./Name` imports for referenced entities
 * and the constructor. Isolated from context/model emission because it owns the
 * per-entity `.ts` file layout — including the self-reference import rule —
 * independently of how the DbContext wires those entities together.
 */
import type { DatabaseColumn } from './database-schema';
import type { EntityShape, ManyToManyJoinShape } from './db-pull-codegen-types';
import { mapStoreTypeToTypeScript } from './db-pull-type-mapping';
import {
    createForeignKeyNavigationNames,
    describeForeignKeyTarget,
    tableKey,
} from './db-pull-emit-helpers';
import { findForeignKeyTargetKey } from './db-pull-relationship-helpers';
import { toKebabFileStem } from './db-pull-naming';

export function renderEntityFile(
    entity: EntityShape,
    entityByTable: ReadonlyMap<string, EntityShape>,
    manyToManyJoins: readonly ManyToManyJoinShape[],
): string {
    const imports: Set<string> = new Set();
    const propertyLines = entity.table.columns.map(column =>
        `  ${renderPropertyDeclaration(column, propertyNameFor(entity, column))};`);
    const foreignKeyNavigationNames = createForeignKeyNavigationNames(entity);
    const navigationLines = entity.table.foreignKeys.map(foreignKey => {
        const principal = entityByTable.get(tableKey(foreignKey.principalSchemaName, foreignKey.principalTableName));
        if (!principal) {
            return `  // TODO: Foreign key ${JSON.stringify(foreignKey.name)} references ${describeForeignKeyTarget(foreignKey)}, which was not included in this db pull snapshot.`;
        }
        if (!findForeignKeyTargetKey(foreignKey, principal)) {
            return `  // TODO: Foreign key ${JSON.stringify(foreignKey.name)} targets columns without a supported primary or unique key; configure this relationship manually.`;
        }
        imports.add(principal.className);
        return `  ${String(foreignKeyNavigationNames.get(foreignKey))}?: ${principal.className} | null;`;
    }).filter((line): line is string => Boolean(line));
    for (const join of manyToManyJoins) {
        if (join.source === entity) {
            imports.add(join.target.className);
            navigationLines.push(`  ${join.sourceNavigationName}!: ${join.target.className}[];`);
        }
        if (join.target === entity) {
            imports.add(join.source.className);
            navigationLines.push(`  ${join.targetNavigationName}!: ${join.source.className}[];`);
        }
    }
    // An entity referencing itself — a parent/child tree, a manager hierarchy —
    // needs no import: the class is declared in this very file, and emitting one
    // produced `import { Node } from "./Node"` inside `Node.ts`, which TypeScript
    // rejects as an import conflicting with a local declaration.
    imports.delete(entity.className);
    const importLines = Array.from(imports)
        .sort()
        .map(name =>
            `import { ${name} } from "./${toKebabFileStem(name)}";`,
        );
    if (propertyLines.some(line => /\bJsonValue\b/.test(line))) {
        importLines.unshift('import type { JsonValue } from "@entitykit/core";');
    }

    return [
        ...importLines,
        importLines.length > 0 ? '' : undefined,
        `export class ${entity.className} {`,
        ...propertyLines,
        ...navigationLines,
        '',
        `  constructor(data?: Partial<${entity.className}>) {`,
        '    Object.assign(this, data);',
        '  }',
        '}',
        '',
    ].filter((line): line is string => line !== undefined).join('\n');
}

function propertyNameFor(
    entity: EntityShape,
    column: DatabaseColumn,
): string {
    const propertyName = entity.propertiesByColumn.get(column.name);
    if (!propertyName) {
        throw new Error(
            `Entity '${entity.className}' has no property for column '${column.name}'.`,
        );
    }
    return propertyName;
}

function renderPropertyDeclaration(column: DatabaseColumn, propertyName: string): string {
    const type = mapStoreTypeToTypeScript(column.storeType).type;
    if (column.isNullable) {
        return `${propertyName}?: ${type} | null`;
    }
    return `${propertyName}!: ${type}`;
}

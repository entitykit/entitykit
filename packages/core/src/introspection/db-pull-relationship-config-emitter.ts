import type { ManyToManyJoinShape } from './db-pull-codegen-types';
import { renderDeleteBehavior } from './db-pull-property-config-emitter';

export function renderManyToManyConfiguration(
    join: ManyToManyJoinShape,
): string {
    const lines = [
        `      entity.hasManyToMany(${join.target.className}, row => row.${join.sourceNavigationName})`,
        `        .withMany(row => row.${join.targetNavigationName})`,
        `        .usingJoinTable(${JSON.stringify(join.joinTable.tableName)}, join => {`,
    ];

    if (join.joinTable.schemaName) {
        lines.push(
            `          join.hasSchema(${JSON.stringify(join.joinTable.schemaName)});`,
        );
    }

    lines.push(
        `          join.primaryKeyName(${JSON.stringify(join.joinTable.primaryKey?.name)});`,
        `          join.sourceForeignKey(${renderColumns(join.sourceForeignKey.columns)});`,
        `          join.targetForeignKey(${renderColumns(join.targetForeignKey.columns)});`,
        `          join.sourceConstraintName(${JSON.stringify(join.sourceForeignKey.name)});`,
        `          join.targetConstraintName(${JSON.stringify(join.targetForeignKey.name)});`,
        '        })',
        `        .onDelete(${renderDeleteBehavior(join.sourceForeignKey.onDelete)});`,
    );

    return lines.join('\n');
}

function renderColumns(columns: readonly string[]): string {
    return JSON.stringify(columns.length === 1 ? columns[0] : columns);
}

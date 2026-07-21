/**
 * Destructive-change detection for scaffolded migrations.
 *
 * Turns diff operations that can lose data — dropped tables, columns, indexes,
 * foreign keys and join tables, plus the lossy facets of an alter — into
 * human-readable warning strings. These surface as review comments at the top
 * of the generated `up()` body so a data-losing change is never applied blindly.
 */
import type { ModelDiffOperation } from './model-differ';
import { formatMigrationObjectName } from './migration-object-name';

/** Perform the collect destructive warnings operation. */ export function collectDestructiveWarnings(operations: readonly ModelDiffOperation[]): readonly string[] {
    return operations.flatMap(operation => {
        switch (operation.kind) {
            case 'dropTable':
                return [`Drop table ${formatMigrationObjectName(operation.schemaName, operation.tableName)}`];
            case 'dropColumn':
                return [`Drop column ${formatMigrationObjectName(operation.schemaName, operation.tableName)}.${operation.columnName}`];
            case 'alterColumn':
                return collectAlterColumnWarnings(operation);
            case 'dropIndex':
                return [`Drop index ${operation.name}`];
            case 'dropForeignKey':
                return [`Drop foreign key ${operation.name}`];
            case 'dropJoinTable':
                return [`Drop join table ${formatMigrationObjectName(operation.schemaName, operation.tableName)}`];
            case 'dropSequence':
                return [`Drop sequence ${formatMigrationObjectName(operation.sequence.schemaName, operation.sequence.name)}`];
            case 'addForeignKey':
            case 'addCheckConstraint':
            case 'dropCheckConstraint':
            case 'createSequence':
            case 'alterSequence':
            case 'rebuildTable':
            case 'createTable':
            case 'renameTable':
            case 'addColumn':
            case 'createIndex':
            case 'createJoinTable':
                return [];
        }
    });
}

function collectAlterColumnWarnings(operation: Extract<ModelDiffOperation, { readonly kind: 'alterColumn' }>): string[] {
    const columnName = `${formatMigrationObjectName(operation.schemaName, operation.tableName)}.${operation.column.name}`;
    const warnings: string[] = [];

    if (operation.column.oldType !== operation.column.type) {
        warnings.push(`Alter column ${columnName} type ${operation.column.oldType ?? 'unknown'} -> ${operation.column.type}`);
    }

    if (operation.column.oldNullable !== operation.column.nullable) {
        warnings.push(`Alter column ${columnName} nullability ${formatNullability(operation.column.oldNullable)} -> ${formatNullability(operation.column.nullable)}`);
    }

    if (operation.column.oldDefaultSql !== operation.column.defaultSql) {
        warnings.push(`Alter column ${columnName} default ${formatDefault(operation.column.oldDefaultSql)} -> ${formatDefault(operation.column.defaultSql)}`);
    }
    if (operation.column.oldComputedSql !== operation.column.computedSql) {
        warnings.push(`Alter column ${columnName} generated expression`);
    }
    if (operation.column.oldCollation !== operation.column.collation) {
        warnings.push(`Alter column ${columnName} collation ${operation.column.oldCollation ?? 'default'} -> ${operation.column.collation ?? 'default'}`);
    }
    if (
        JSON.stringify(operation.column.oldStoreGeneration) !==
        JSON.stringify(operation.column.storeGeneration)
    ) {
        warnings.push(
            `Alter column ${columnName} generation ${
                operation.column.oldStoreGeneration?.kind ?? 'none'
            } -> ${operation.column.storeGeneration?.kind ?? 'none'}`,
        );
    }

    return warnings;
}

function formatNullability(nullable: boolean | undefined): string {
    return nullable ? 'nullable' : 'not null';
}

function formatDefault(defaultSql: string | undefined): string {
    return defaultSql ?? 'no default';
}

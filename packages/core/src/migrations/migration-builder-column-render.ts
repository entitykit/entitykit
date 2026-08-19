import type { SqlDialect } from '../sql/sql-dialect';
import type { MigrationColumnDefinition } from './migration-builder-types';
import { storeGenerationClause } from '../schema/store-generation-clause';
import { assertExclusiveStoreGeneration } from './migration-builder-store-generation';

/**
 * WHY: Renders a single column definition into its DDL fragment
 * (`"name" type [primary key] [not null] [default ...]`). Extracted into its own
 * leaf because both the table-level DDL (`createTable`) and the column-level DDL
 * (`addColumn`) need it; keeping it here lets those sibling operation modules
 * share the logic without depending on one another.
 */
export function renderColumn(
    column: MigrationColumnDefinition,
    dialect: SqlDialect,
    isKey = Boolean(column.primaryKey),
): string {
    assertExclusiveStoreGeneration(column);
    const columnType = dialect.mapColumnType?.(column.type, {
        isKey,
        collation: column.collation,
    }) ?? column.type;
    const parts = [dialect.quoteIdentifier(column.name), columnType];

    if (column.collation) {
        parts.push(`collate ${dialect.quoteIdentifier(column.collation)}`);
    }

    if (column.primaryKey) {
        parts.push('primary key');
    }

    if (!column.nullable && !column.primaryKey) {
        parts.push('not null');
    }
    const generation = storeGenerationClause(
        dialect,
        column.storeGeneration,
        { type: column.type, isPrimaryKey: isKey },
    );
    if (generation) {
        parts.push(generation);
    }

    if (column.computedSql !== undefined) {
        const clause = dialect.generatedColumnClause?.(
            column.computedSql,
            column.computedStored ?? true,
        );
        if (!clause) {
            throw new Error(`Generated columns are not supported by the '${dialect.name}' provider.`);
        }
        parts.push(clause);
    } else if (column.defaultSql !== undefined) {
        parts.push(`default ${column.defaultSql}`);
    }

    return parts.join(' ');
}

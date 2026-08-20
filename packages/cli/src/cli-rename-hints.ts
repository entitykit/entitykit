import type { ModelDiffRenameHints } from '@entitykit/core/migrations';
import { CliUsageError } from './cli-usage-error';

export function parseRenameHintValues(
    tableValues: readonly string[],
    columnValues: readonly string[],
): ModelDiffRenameHints | undefined {
    const tables = tableValues.map(parseTableRename);
    const columns = columnValues.map(parseColumnRename);
    return tables.length > 0 || columns.length > 0
        ? { tables, columns }
        : undefined;
}

function parseTableRename(
    value: string,
): NonNullable<ModelDiffRenameHints['tables']>[number] {
    const [from, to, ...extra] = value.split('=');
    if (!from || !to || extra.length > 0) {
        throw new CliUsageError('--rename-table expects old_table=new_table.');
    }

    const fromParts = qualifiedParts(from, '--rename-table');
    const toParts = qualifiedParts(to, '--rename-table');
    if (fromParts.length > 2) {
        throw new CliUsageError(
            '--rename-table supports old_table=new_table or schema.old_table=new_table.',
        );
    }

    return fromParts.length === 2
        ? {
            schemaName: fromParts[0],
            from: fromParts[1],
            to: lastQualifiedPart(toParts),
        }
        : { from, to: lastQualifiedPart(toParts) };
}

function parseColumnRename(
    value: string,
): NonNullable<ModelDiffRenameHints['columns']>[number] {
    const [from, to, ...extra] = value.split('=');
    if (!from || !to || extra.length > 0) {
        throw new CliUsageError(
            '--rename-column expects table.old_column=new_column.',
        );
    }

    const fromParts = qualifiedParts(from, '--rename-column');
    const toParts = qualifiedParts(to, '--rename-column');
    if (fromParts.length === 2) {
        return {
            tableName: fromParts[0],
            from: fromParts[1],
            to: lastQualifiedPart(toParts),
        };
    }
    if (fromParts.length === 3) {
        return {
            schemaName: fromParts[0],
            tableName: fromParts[1],
            from: fromParts[2],
            to: lastQualifiedPart(toParts),
        };
    }

    throw new CliUsageError(
        '--rename-column supports table.old_column=new_column or schema.table.old_column=new_column.',
    );
}

function qualifiedParts(value: string, option: string): string[] {
    const parts = value.split('.');
    if (parts.some(part => part.length === 0)) {
        throw new CliUsageError(
            `${option} identifiers cannot contain empty qualified parts.`,
        );
    }
    return parts;
}

function lastQualifiedPart(parts: readonly string[]): string {
    return parts[parts.length - 1];
}

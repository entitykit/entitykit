import { MigrationDataLossError } from '../../errors/migration-errors';
import { DatabaseProviderError } from '../../storage/database-provider-error';

/** Render structured EntityKit failures without exposing parameter values. */
export function formatCliError(error: unknown): string {
    if (error instanceof DatabaseProviderError) {
        const lines = [
            error.message,
            `Operation: ${error.operation}`,
        ];
        if (error.code) {
            lines.push(`Code: ${error.code}`);
        }
        if (error.detail) {
            lines.push(`Detail: ${error.detail}`);
        }
        if (error.constraint) {
            lines.push(`Constraint: ${error.constraint}`);
        }
        if (error.table) {
            lines.push(`Table: ${error.table}`);
        }
        if (error.column) {
            lines.push(`Column: ${error.column}`);
        }
        if (error.statement) {
            lines.push(`Statement: ${error.statement.text}`);
        }
        return lines.join('\n');
    }

    if (error instanceof MigrationDataLossError) {
        return [
            error.message,
            '',
            'Warnings:',
            ...error.warnings.map(warning => `  - ${warning}`),
        ].join('\n');
    }

    return error instanceof Error ? error.message : String(error);
}

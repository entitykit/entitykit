import {
    DatabaseProviderError,
    DatabaseTransactionCleanupError,
} from '../../storage/database-errors';
import { TransactionOutcomeUnknownError } from '../../storage/transaction-outcome-unknown-error';
import type { SavePlanEntry } from '../../core/save-plan';
import type {
    RuntimeDiagnosticEvent,
    SaveChangesDiagnosticPlanEntry,
} from './events';

const redactedValue = '[REDACTED]';

export function sanitizeRuntimeDiagnosticEvent(
    event: RuntimeDiagnosticEvent,
): RuntimeDiagnosticEvent {
    if (event.kind === 'query') {
        return {
            ...event,
            statement: {
                text: event.statement.text,
                values: event.statement.values.map(() => redactedValue),
            },
            error: sanitizeError(event.error),
        };
    }
    if (event.kind === 'saveChanges') {
        return {
            ...event,
            plan: event.plan.map(sanitizeSavePlanEntry),
            error: sanitizeError(event.error),
        };
    }
    if ('error' in event && event.error !== undefined) {
        return { ...event, error: sanitizeError(event.error) };
    }
    return event;
}

function sanitizeSavePlanEntry(
    entry: SavePlanEntry | SaveChangesDiagnosticPlanEntry,
): SaveChangesDiagnosticPlanEntry {
    return {
        entityName: entry.entityName,
        state: entry.state,
        statement: {
            text: entry.statement.text,
            values: entry.statement.values.map(() => redactedValue),
        },
        affectedEntityCount: entry.affectedEntityCount,
        ...entry.isDeferred ? { isDeferred: true } : {},
        expectedAffectedRows: entry.expectedAffectedRows,
        skipAffectedRowsCheck: entry.skipAffectedRowsCheck,
        isSystemGenerated: entry.isSystemGenerated,
    };
}

function sanitizeError(error: unknown): unknown {
    if (error === undefined) {
        return undefined;
    }
    if (error instanceof TransactionOutcomeUnknownError) {
        return {
            name: error.name,
            message: 'A database commit outcome is unknown.',
            provider: error.provider,
            operation: error.operation,
            retryable: error.retryable,
        };
    }
    if (error instanceof DatabaseTransactionCleanupError) {
        return {
            name: error.name,
            message: 'A database transaction cleanup operation failed.',
            provider: error.provider,
            operation: error.operation,
            primaryError: sanitizeError(error.primaryError),
            cleanupError: sanitizeError(error.cleanupError),
        };
    }
    if (error instanceof DatabaseProviderError) {
        return {
            name: error.name,
            message: 'A database provider operation failed.',
            provider: error.provider,
            operation: error.operation,
            code: error.code,
            constraint: error.constraint,
            table: error.table,
            column: error.column,
        };
    }
    if (error instanceof Error) {
        return { name: error.name, message: 'Error details redacted.' };
    }
    return redactedValue;
}

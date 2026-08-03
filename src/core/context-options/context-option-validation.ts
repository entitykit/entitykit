import type {
    DiagnosticsOptions,
    RuntimeDiagnosticsHandler,
} from '../../diagnostics/runtime/events';
import { sanitizeRuntimeDiagnosticEvent } from '../../diagnostics/runtime/sanitize-event';
import type { LazyLoadingOptions } from './db-context-option-types';

export function validateLazyLoadingOptions(options: LazyLoadingOptions): void {
    if (
        options.maxPerContext !== undefined
        && (!Number.isInteger(options.maxPerContext) || options.maxPerContext < 1)
    ) {
        throw new Error(
            `useLazyLoading maxPerContext must be a positive integer, received ${String(options.maxPerContext)}.`,
        );
    }
}

export function createRuntimeDiagnosticsHandler(
    handler: RuntimeDiagnosticsHandler,
    options: DiagnosticsOptions,
): RuntimeDiagnosticsHandler {
    if (typeof handler !== 'function') {
        throw new Error('useDiagnostics requires a diagnostic event handler.');
    }
    if (
        options.includeSensitiveData !== undefined
        && typeof options.includeSensitiveData !== 'boolean'
    ) {
        throw new Error('Diagnostics includeSensitiveData must be a boolean.');
    }
    return event => {
        try {
            handler(options.includeSensitiveData
                ? event
                : sanitizeRuntimeDiagnosticEvent(event));
        } catch {
            // Diagnostics observe application work; they never participate in it.
        }
    };
}

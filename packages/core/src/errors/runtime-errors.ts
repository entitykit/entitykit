import { EntityKitError } from './entity-kit-error';

/** Typed error reported for context not initialized failures. */ export class ContextNotInitializedError extends EntityKitError {
    constructor() {
        super('DbContext has not been initialized. Use DbContext.create().', {
            code: 'CONTEXT_NOT_INITIALIZED',
        });
    }
}

/** Typed error reported for context disposed failures. */ export class ContextDisposedError extends EntityKitError {
    constructor(operation: string) {
        super(
            `DbContext was disposed, so ${operation} cannot run. Create a new context instead of reusing a disposed one.`,
            { code: 'CONTEXT_DISPOSED', details: { operation } },
        );
    }
}

/** Typed error reported for context concurrent operation failures. */ export class ContextConcurrentOperationError extends EntityKitError {
    constructor(operation: string, message?: string) {
        super(
            message ?? `A database operation is already in progress on this DbContext. Await it before starting ${operation}, or use a separate context.`,
            { code: 'CONTEXT_CONCURRENT_OPERATION', details: { operation } },
        );
    }
}

/** Typed error reported when cleanup cannot restore context state. */
export class ContextStateRestorationError extends EntityKitError {
    constructor(phase: 'commit' | 'rollback', cause: unknown) {
        super(
            'DbContext state restoration failed while restoring in-memory ' +
            'context state. Its in-memory state may no longer match the ' +
            'database, so create a new context.',
            {
                code: 'CONTEXT_STATE_RESTORATION_FAILED',
                cause,
                details: { phase },
            },
        );
    }
}

/** Typed error reported when an explicitly cancelable operation is aborted. */
export class OperationCanceledError extends EntityKitError {
    constructor(reason?: unknown) {
        super('The database operation was canceled.', {
            code: 'OPERATION_CANCELED',
            cause: reason,
        });
    }
}

/** Typed error reported for provider capability failures. */ export class ProviderCapabilityError extends EntityKitError {
    constructor(capability: string, provider?: string) {
        super(
            `${provider ? `Provider '${provider}'` : 'The configured provider'} does not support ${capability}.`,
            {
                code: 'PROVIDER_CAPABILITY_UNSUPPORTED',
                details: { capability, provider },
            },
        );
    }
}

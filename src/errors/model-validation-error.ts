import { EntityKitError } from './entity-kit-error';

/** Typed error reported for model validation failures. */ export class ModelValidationError extends EntityKitError {
    constructor(
        message: string,
        details?: Readonly<Record<string, unknown>>,
        cause?: unknown,
    ) {
        super(message, { code: 'MODEL_VALIDATION', details, cause });
    }
}

export function asModelValidationError(error: unknown): ModelValidationError {
    if (error instanceof ModelValidationError) {
        return error;
    }
    return new ModelValidationError(
        error instanceof Error ? error.message : 'EntityKit model validation failed.',
        undefined,
        error,
    );
}

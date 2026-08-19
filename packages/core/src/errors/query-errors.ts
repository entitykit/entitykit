import { EntityKitError } from './entity-kit-error';

/** Typed error reported for query compilation failures. */ export class QueryCompilationError extends EntityKitError {
    constructor(message: string, details?: Readonly<Record<string, unknown>>) {
        super(message, { code: 'QUERY_COMPILATION', details });
    }
}

/** Typed error reported for entity not found failures. */ export class EntityNotFoundError extends EntityKitError {
    constructor(entityName: string, operation = 'query') {
        super(formatQueryErrorMessage('No', entityName, operation), {
            code: 'ENTITY_NOT_FOUND',
            details: { entityName, operation },
        });
    }
}

/** Typed error reported for multiple entities found failures. */ export class MultipleEntitiesFoundError extends EntityKitError {
    constructor(entityName: string, operation = 'query') {
        super(formatQueryErrorMessage('More than one', entityName, operation), {
            code: 'MULTIPLE_ENTITIES_FOUND',
            details: { entityName, operation },
        });
    }
}

function formatQueryErrorMessage(prefix: 'No' | 'More than one', entityName: string, operation: string): string {
    if (operation === 'projection') {
        return `${prefix} '${entityName}' projection matched the query.`;
    }

    return `${prefix} '${entityName}' entity matched the ${operation}.`;
}

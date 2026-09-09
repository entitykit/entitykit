import { EntityKitError } from './entity-kit-error';

/** The requested object has no entry in this context's change tracker. */
export class EntityNotTrackedError extends EntityKitError {
    constructor() {
        super('Entity is not tracked by this DbContext. Query, add, or attach it before requesting its entry.', {
            code: 'ENTITY_NOT_TRACKED',
        });
    }
}

/** Typed error reported when an entry does not belong to the loading context. */
export class ForeignEntityEntryError extends EntityKitError {
    constructor() {
        super(
            'EntityEntry belongs to another DbContext or is no longer tracked.',
            { code: 'FOREIGN_ENTITY_ENTRY' },
        );
    }
}

/** Typed error reported when a navigation has no loadable tracked identity. */
export class NavigationLoadUnavailableError extends EntityKitError {
    constructor(
        reason: 'added' | 'untracked',
        entityName: string,
        navigationProperty?: string,
    ) {
        super(
            reason === 'added'
                ? 'Navigation loading is unavailable for an Added entity because it has no persisted identity.'
                : `lazy(...).${String(navigationProperty)} needs an entity tracked by this DbContext. ` +
                    `'${entityName}' is not tracked — it may have been detached, or the tracker cleared.`,
            {
                code: 'NAVIGATION_LOAD_UNAVAILABLE',
                details: { entityName, navigationProperty, reason },
            },
        );
    }
}

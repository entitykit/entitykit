import type { PropertyMetadata } from './model/property-metadata';
import {
    readPropertyPath,
    readPropertyValue,
} from './model/property-value-access';
import type { RestorationScope } from './restoration-scope';
import { snapshotPropertyValue } from './tracking/snapshot-value';
import {
    restorePropertyPath,
    restorePropertyValue,
} from './property-value-restoration';
import {
    writeVerifiedPath,
    writeVerifiedProperty,
} from './verified-property-write';

interface FailureAtomicPropertyWrite {
    readonly entity: object;
    readonly property: PropertyMetadata;
    readonly value: unknown;
    readonly scope: RestorationScope;
    readonly context?: string;
    readonly recordApplied?: (
        previous: unknown,
        applied: unknown,
    ) => void;
}

/** Write, read back, and journal one live property as one atomic operation. */
export function writeFailureAtomicProperty(
    options: FailureAtomicPropertyWrite,
): unknown {
    const previous = readPropertyValue(options.entity, options.property);
    const context = options.context ?? options.property.propertyName;
    const previousSnapshot = snapshotPropertyValue(
        previous, options.property.converter, context,
    );
    try {
        const applied = writeVerifiedProperty(
            options.entity,
            options.property,
            options.value,
            context,
        );
        options.recordApplied?.(previous, applied);
        return applied;
    } catch (error) {
        options.scope.capturePrimary(error);
        options.scope.attempt(() => {
            restorePropertyValue(
                options.entity, options.property, previous,
                previousSnapshot, context,
            );
        });
        throw error;
    }
}

interface FailureAtomicPathWrite {
    readonly entity: object;
    readonly path: readonly string[];
    readonly value: unknown;
    readonly scope: RestorationScope;
    readonly context: string;
}

/** Write one object path with immediate verified restoration on failure. */
export function writeFailureAtomicPath(
    options: FailureAtomicPathWrite,
): unknown {
    const previous = readPropertyPath(options.entity, options.path);
    try {
        return writeVerifiedPath(
            options.entity, options.path, options.value, options.context,
        );
    } catch (error) {
        options.scope.capturePrimary(error);
        options.scope.attempt(() => {
            restorePropertyPath(
                options.entity, options.path, previous, options.context,
            );
        });
        throw error;
    }
}

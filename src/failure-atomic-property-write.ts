import type { PropertyMetadata } from './model/property-metadata';
import {
    readPropertyValue,
    writePropertyValue,
} from './model/property-value-access';
import type { RestorationScope } from './restoration-scope';
import { snapshotPropertyValue } from './tracking/snapshot-value';
import { restorePropertyValue } from './property-value-restoration';

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
        writePropertyValue(
            options.entity,
            options.property,
            options.value,
        );
        const applied = readPropertyValue(options.entity, options.property);
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

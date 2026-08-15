import type { EntityEntry } from '../tracking/entity-entry';
import type { PropertyMetadata } from '../model/property-metadata';
import {
    propertyValueTarget,
    readPropertyPath,
    readPropertyValue,
} from '../model/property-value-access';
import {
    snapshotPropertyValue,
    snapshotPropertyValuesEqual,
} from '../tracking/snapshot-value';
import { runRestorationActions } from '../restoration-actions';
import { restorePropertyValue } from '../property-value-restoration';
import { createdAncestorRestoration } from './created-ancestor-restoration';

interface SaveTimeMutation {
    restore(): void;
}
/** Records temporary entity writes so a failed save can put them back. */
export class SaveTimeMutationLog {
    private mutations: SaveTimeMutation[] = [];
    public reset(): void {
        this.mutations = [];
    }
    public record(values: Record<string, unknown>, property: string): void {
        this.recordCaptured(values, property, values[property]);
    }
    /** Record a value already read by the executable entity capture. */
    public recordCaptured(
        values: Record<string, unknown>,
        property: string,
        previous: unknown,
    ): void {
        this.mutations.push({
            restore: () => {
                values[property] = previous;
            },
        });
    }
    /** Remove only the exact framework-created ancestor while it stays pristine. */
    public recordCreatedAncestor(
        target: Record<string, unknown>,
        property: string,
        previous: unknown,
        created: object,
        isPristine: () => boolean,
    ): () => void {
        const restoration = createdAncestorRestoration(
            target, property, previous, created, isPristine,
        );
        this.mutations.push({ restore: restoration.rollback });
        return restoration.restoreAfterWriteFailure;
    }
    /** Restore a policy write only while its provisional value is still live. */
    public recordApplied(
        entity: object,
        property: PropertyMetadata,
        previous: unknown,
        applied: unknown,
        context: string,
        onRestored?: (restored: boolean) => void,
    ): void {
        const appliedSnapshot = snapshotPropertyValue(
            applied,
            property.converter,
            context,
        );
        const previousSnapshot = snapshotPropertyValue(
            previous,
            property.converter,
            context,
        );
        const appliedTarget = propertyValueTarget(
            entity,
            property.propertyPath,
        ).target;
        this.mutations.push({
            restore: () => {
                let restored = false;
                try {
                    const parentPath = property.propertyPath.slice(0, -1);
                    const currentTarget = readPropertyPath(entity, parentPath);
                    if (currentTarget !== appliedTarget) return;
                    if (snapshotPropertyValuesEqual(
                        readPropertyValue(entity, property),
                        appliedSnapshot,
                        property.converter,
                        context,
                    )) {
                        restorePropertyValue(
                            entity, property, previous,
                            previousSnapshot, context,
                        );
                        restored = true;
                    }
                } finally {
                    onRestored?.(restored);
                }
            },
        });
    }

    public recordAppliedState(
        entry: EntityEntry<object>,
        previous: EntityEntry<object>['state'],
        applied: EntityEntry<object>['state'],
    ): void {
        this.mutations.push({
            restore: () => {
                if (entry.state === applied) {
                    entry.transitionToState(previous);
                }
            },
        });
    }

    /** Record a guarded non-scalar policy mutation such as navigation fix-up. */
    public recordRestoration(restore: () => void): void {
        this.mutations.push({ restore });
    }

    public restore(): void {
        this.takeRollback()();
    }

    public accept(): void {
        this.reset();
    }

    /** Accept the mutations now while retaining a one-shot rollback journal. */
    public takeRollback(): () => void {
        const accepted = this.mutations;
        this.mutations = [];
        let pending = true;
        return () => {
            if (!pending) {
                return;
            }
            pending = false;
            runRestorationActions(
                [...accepted].reverse().map(mutation =>
                    mutation.restore.bind(mutation)),
            );
        };
    }
}

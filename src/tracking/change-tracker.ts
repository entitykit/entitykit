import type { EntityMetadata } from '../model/entity-metadata';
import { ChangeTrackerAcceptance } from './change-tracker-acceptance';
import { formatChangeTracker } from './change-tracker-debug';
import type { EntityEntry } from './entity-entry';
import type { EntityState } from './entity-state';
import { changeTrackerModel } from './change-tracker-model';
import { detectRelationshipChanges } from './relationship-change-detector';
import type { PersistedEntrySnapshot } from './persisted-entry-snapshot';
import { SaveMutationGuard } from './save-mutation-guard';
import type { TrackedAcceptance } from './tracked-acceptance-journal';
import { ChangeTrackerRegistry } from './change-tracker-registry';

export class ChangeTracker {
    private readonly saveGuard = new SaveMutationGuard();
    private readonly registry = new ChangeTrackerRegistry(
        this,
        (operation, entity, identityKey) => {
            this.saveGuard.assertMutation(operation, entity, identityKey);
        },
        entity => {
            this.onTracked?.(entity);
        },
    );
    private readonly acceptance = new ChangeTrackerAcceptance(
        () => this.entries(),
        entry => this.registry.has(entry),
        this.registry.identities,
        entity => {
            this.registry.detach(entity);
        },
        entry => {
            this.registry.restore(entry);
        },
        (entries, identityKeys) => this.saveGuard.defer(entries, identityKeys),
        () => {
            this.registry.assertInvariant();
        },
    );
    private onTracked?: (entity: object) => void;

    public observeTracked(observer: (entity: object) => void): void {
        this.onTracked = observer;
    }

    public track<TEntity extends object>(
        entity: TEntity,
        metadata: EntityMetadata<TEntity>,
        state: EntityState,
        originalValues?: Record<string, unknown>,
    ): EntityEntry<TEntity> {
        return this.registry.track(entity, metadata, state, originalValues);
    }

    public entry<TEntity extends object>(entity: TEntity): EntityEntry<TEntity> | undefined {
        return this.registry.entry(entity);
    }

    public tryGetByIdentity<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        keyValue: unknown,
    ): EntityEntry<TEntity> | undefined {
        return this.tryGetByIdentityValues(metadata, [keyValue]);
    }

    /** Look up a tracked entry by its key values, in declaration order. */
    public tryGetByIdentityValues<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        keyValues: readonly unknown[],
    ): EntityEntry<TEntity> | undefined {
        return this.registry.identities.get(metadata.createIdentityKeyFromValues(keyValues)) as unknown as EntityEntry<TEntity> | undefined;
    }

    public entries(): ReadonlyArray<EntityEntry<object>> {
        return this.registry.entries();
    }

    public detach<TEntity extends object>(entity: TEntity): EntityEntry<TEntity> | undefined {
        this.saveGuard.assertMutation('Detaching an entity', entity);
        return this.registry.detach(entity);
    }

    public detectChanges(): void {
        this.detectSaveRelationships();
        for (const entry of this.registry.entries()) {
            entry.detectChanges();
        }
    }

    /** Apply tracked graph fix-up before one executable value capture. */
    public detectSaveRelationships(): void {
        const configuredModel = changeTrackerModel(this);
        if (configuredModel) {
            detectRelationshipChanges(this, configuredModel);
        }
    }
    public acceptAllChanges(): void {
        this.saveGuard.assertMutation('acceptAllChanges()');
        this.acceptance.acceptAll();
    }

    /** Accept only the entries and values represented by an executed plan. */
    public acceptPersistedChanges(
        snapshots: readonly PersistedEntrySnapshot[],
    ): TrackedAcceptance {
        return this.acceptance.acceptPersisted(snapshots);
    }
    public clear(): void {
        this.saveGuard.assertMutation('Clearing tracked entities');
        this.registry.clear();
    }

    public debugView(): string {
        this.detectChanges();
        return formatChangeTracker(this.entries());
    }

    public beginSaveExecution(): () => void {
        return this.saveGuard.beginExecution();
    }
}

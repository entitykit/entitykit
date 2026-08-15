import type { EntityMetadata } from '../model/entity-metadata';
import { formatChangeTracker } from './change-tracker-debug';
import type { EntityEntry } from './entity-entry';
import type { EntityState } from './entity-state';
import type { PersistedEntrySnapshot } from './persisted-entry-snapshot';
import { SaveMutationGuard } from './save-mutation-guard';
import type { TrackedAcceptance } from './tracked-acceptance-journal';
import { ChangeTrackerRegistry } from './change-tracker-registry';
import { detectTrackedChanges, detectTrackedRelationships } from './change-tracker-detection';
import { createChangeTrackerAcceptance } from './change-tracker-acceptance-factory';
import type { RelationshipDetectionValues } from './relationship-detection-values';
import type { RestorationScope } from '../restoration-scope';
import { runRestorableTrackerOperation } from './restorable-tracker-operation';
import { trackedByBoundIdentity, trackedByIdentity } from './change-tracker-identity-lookup';
import { ChangeTrackerObservers } from './change-tracker-observers';
export class ChangeTracker {
    private readonly saveGuard = new SaveMutationGuard();
    private readonly observers = new ChangeTrackerObservers();
    private readonly registry = new ChangeTrackerRegistry(
        this,
        (operation, entity, identityKey) => {
            this.saveGuard.assertMutation(operation, entity, identityKey);
        },
        entity => this.observers.notifyTracked(entity),
        entity => this.observers.notifyDetached(entity),
    );
    private readonly acceptance = createChangeTrackerAcceptance(this.registry, this.saveGuard);
    constructor(
        assertUsable: (operation: string) => void = () => undefined,
        private readonly markRestorationFailure: (error: unknown) => void = () => undefined,
    ) {
        this.saveGuard.useUsabilityGuard(assertUsable);
    }
    public observeTracked(observer: (entity: object) => (() => void) | undefined): void {
        this.observers.observeTracked(observer);
    }
    public observeDetached(
        observer: (entity: object) => (() => void) | undefined,
    ): void {
        this.observers.observeDetached(observer);
    }
    public observeAcceptedAll(observer: () => void): void {
        this.observers.observeAcceptedAll(observer);
    }
    public track<TEntity extends object>(
        entity: TEntity,
        metadata: EntityMetadata<TEntity>,
        state: EntityState,
        originalValues?: Record<string, unknown>,
        originalBoundValues?: Record<string, unknown>,
    ): EntityEntry<TEntity> {
        return this.registry.track(entity, metadata, state,
            originalValues, originalBoundValues);
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
    public tryGetByIdentityValues<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        keyValues: readonly unknown[],
        tenantValue?: unknown,
    ): EntityEntry<TEntity> | undefined {
        return trackedByIdentity(this.registry, metadata,
            keyValues, tenantValue);
    }
    public tryGetByBoundIdentityValues<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        boundValues: Readonly<Record<string, unknown>>,
    ): EntityEntry<TEntity> | undefined {
        return trackedByBoundIdentity(this.registry, metadata, boundValues);
    }
    public entries(): ReadonlyArray<EntityEntry<object>> {
        return this.registry.entries();
    }
    public detach<TEntity extends object>(entity: TEntity): EntityEntry<TEntity> | undefined {
        this.saveGuard.assertMutation('Detaching an entity', entity);
        const entry = this.registry.detach(entity);
        if (entry) this.observers.notifyDetached(entity);
        return entry;
    }
    public detectChanges(): void {
        this.saveGuard.assertNoExecution('detectChanges()');
        this.runRestorable(restoration => {
            detectTrackedChanges(this, this.registry.entries(), restoration);
        });
    }
    public detectSaveRelationships(
        entries?: ReadonlyArray<EntityEntry<object>>, values?: RelationshipDetectionValues,
        refreshBaselines = true,
        restoration?: RestorationScope,
        beforeCommit?: () => void,
    ): void {
        this.saveGuard.assertNoExecution('detectSaveRelationships()');
        this.runRestorable(scope => {
            detectTrackedRelationships(
                this, entries, values, refreshBaselines, scope, beforeCommit);
        }, restoration);
    }
    public acceptAllChanges(): void {
        this.saveGuard.assertMutation('acceptAllChanges()');
        const entries = this.entries();
        this.runRestorable(restoration => {
            this.acceptance.acceptAll(restoration);
        });
        for (const entry of entries)
            if (!this.registry.has(entry)) this.observers.notifyDetached(entry.entity);
        this.observers.notifyAcceptedAll();
    }
    public acceptPersistedChanges(
        snapshots: readonly PersistedEntrySnapshot[],
        restoration: RestorationScope,
    ): TrackedAcceptance {
        return this.acceptance.acceptPersisted(snapshots, true, restoration);
    }
    public clear(): void {
        this.saveGuard.assertMutation('Clearing tracked entities');
        const entities = this.entries().map(entry => entry.entity);
        this.registry.clear();
        for (const entity of entities) this.observers.notifyDetached(entity);
    }
    public debugView(): string {
        this.saveGuard.assertNoExecution('debugView()');
        this.runRestorable(restoration => {
            detectTrackedChanges(this, this.registry.entries(), restoration);
        });
        return formatChangeTracker(this.entries());
    }
    public beginSaveExecution(): () => void {
        return this.saveGuard.beginExecution();
    }
    public reserveUntrackedEntities(entities: readonly object[]): () => void {
        return this.saveGuard.reserveUpsertInputs(entities);
    }
    private runRestorable(
        action: (restoration: RestorationScope) => void,
        restoration?: RestorationScope,
    ): void {
        runRestorableTrackerOperation(
            this.markRestorationFailure, action, restoration,
        );
    }
}

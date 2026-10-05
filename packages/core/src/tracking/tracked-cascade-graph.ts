import type { Model } from '../model/model';
import type { EntityMetadata } from '../model/entity-metadata';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import { EntityState } from './entity-state';
import { findTrackedPrincipal, relationshipConnects } from './relationship-resolution';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';
import type { RelationshipDetectionValues } from './relationship-detection-values';

export interface TrackedCascadeEdge {
    readonly dependent: EntityEntry<object>;
    readonly relationship: TrackedRelationshipMetadata;
}

type PrincipalType = EntityMetadata['ctor'];
type PrincipalEdges = ReadonlyMap<EntityEntry<object>, readonly TrackedCascadeEdge[]>;

/** Resolve each affected relationship once, through the captured key/tenant rules. */
export class TrackedCascadeGraph {
    private readonly candidates: Map<PrincipalType, TrackedCascadeEdge[]> = new Map();
    private readonly resolved: Map<PrincipalType, PrincipalEdges> = new Map();

    constructor(
        private readonly tracker: ChangeTracker,
        private readonly model: Model,
        entries: ReadonlyArray<EntityEntry<object>>,
        private readonly captured: RelationshipDetectionValues,
    ) {
        for (const dependent of entries) {
            for (const relationship of dependent.metadata.relationships as readonly TrackedRelationshipMetadata[]) {
                const candidates = this.candidates.get(relationship.principalEntity) ?? [];
                candidates.push({ dependent, relationship });
                this.candidates.set(relationship.principalEntity, candidates);
            }
        }
    }

    public dependentsOf(principal: EntityEntry<object>): readonly TrackedCascadeEdge[] {
        const type = principal.metadata.ctor;
        let resolved = this.resolved.get(type);
        if (!resolved) {
            resolved = this.resolve(type);
            this.resolved.set(type, resolved);
        }
        return resolved.get(principal) ?? [];
    }

    private resolve(type: PrincipalType): PrincipalEdges {
        const resolved: Map<EntityEntry<object>, TrackedCascadeEdge[]> = new Map();
        for (const edge of this.candidates.get(type) ?? []) {
            const { dependent, relationship } = edge;
            if (dependent.state === EntityState.Deleted || dependent.state === EntityState.Detached) continue;
            const navigation = (dependent.entity as Record<string, unknown>)[relationship.navigationProperty];
            const explicit = navigation && typeof navigation === 'object' ? this.tracker.entry(navigation) : undefined;
            const principal = explicit?.metadata.ctor === type && relationshipConnects(
                this.tracker, this.model, dependent, relationship, explicit, this.captured,
            ) ? explicit : findTrackedPrincipal(
                    this.tracker, this.model, dependent, relationship, this.captured,
                );
            if (!principal) continue;
            const edges = resolved.get(principal) ?? [];
            edges.push(edge);
            resolved.set(principal, edges);
        }
        return resolved;
    }
}

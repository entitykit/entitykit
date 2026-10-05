import { RelationshipCardinality } from '../model/relationship-metadata';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import { cloneNavigationContainer, copyNavigationCollection } from './navigation-collection-copy';
import type { NavigationLoadTrackerJournal } from './navigation-load-tracker-journal';
import { captureNavigation, navigationValueChanged } from './navigation-snapshot';
import type { NavigationWriter } from './navigation-writer';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';

interface CollectionItem { readonly value: unknown }
interface CollectionChange {
    readonly entry: EntityEntry<object>;
    readonly property: string;
    readonly previous: unknown;
    readonly items: CollectionItem[];
    readonly active: Map<unknown, CollectionItem>;
}

/** Accumulate inverse edits without publishing or copying a growing collection. */
export class LoadedInverseCollectionBatch {
    private readonly changes: Map<object, Map<string, CollectionChange>> = new Map();

    constructor(
        private readonly tracker: ChangeTracker,
        private readonly writer: NavigationWriter,
        private readonly trackerJournal: NavigationLoadTrackerJournal,
    ) {}

    public add(relationship: TrackedRelationshipMetadata, principal: object, dependent: object): boolean {
        const change = this.collection(relationship, principal);
        if (!change) return false;
        if (!change.active.has(dependent)) {
            const item = { value: dependent };
            change.active.set(dependent, item);
            change.items.push(item);
        }
        return true;
    }

    public remove(relationship: TrackedRelationshipMetadata, principal: object, dependent: object): boolean {
        const property = relationship.inverseNavigationProperty;
        if (!property || !Array.isArray((principal as Record<string, unknown>)[property])) return false;
        const change = this.collection(relationship, principal);
        if (!change) return false;
        change.active.delete(dependent);
        return true;
    }

    public publish(captureBaseline: typeof captureNavigation = captureNavigation): void {
        for (const properties of this.changes.values()) {
            for (const change of properties.values()) {
                const { entry, property, previous } = change;
                const current = (entry.entity as Record<string, unknown>)[property];
                if (this.tracker.entry(entry.entity) !== entry || navigationValueChanged(previous, current)) {
                    throw new Error(`Navigation '${entry.metadata.entityName}.${property}' changed while its load was in progress.`);
                }
                this.trackerJournal.touch(entry, property);
                this.writer.write(entry.entity, property, change.items
                    .filter(item => change.active.get(item.value) === item)
                    .map(item => item.value), entry.metadata.entityName);
                captureBaseline(entry, property);
            }
        }
        this.changes.clear();
    }

    private collection(relationship: TrackedRelationshipMetadata, principal: object): CollectionChange | undefined {
        const property = relationship.inverseNavigationProperty;
        const entry = this.tracker.entry(principal);
        if (!property || !entry || relationship.cardinality === RelationshipCardinality.OneToOne) return undefined;
        const properties = this.changes.get(principal) ?? new Map<string, CollectionChange>();
        this.changes.set(principal, properties);
        const existing = properties.get(property);
        if (existing) return existing;
        const previous = cloneNavigationContainer((principal as Record<string, unknown>)[property]);
        const active: Map<unknown, CollectionItem> = new Map();
        // Shared tokens preserve pre-existing duplicates; removing then adding
        // an item gives it a new token at the end, matching sequential fixup.
        const items = copyNavigationCollection(previous).map(value => {
            const item = active.get(value) ?? { value };
            active.set(value, item);
            return item;
        });
        const created = { entry, property, previous, active, items };
        properties.set(property, created);
        return created;
    }
}

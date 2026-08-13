import type { RelationshipKeyMetadata } from '../model/relationship-key-codec';
import {
    navigationSnapshot,
    navigationValueChanged,
} from '../tracking/navigation-snapshot';
import { captureReferenceForeignKeyFacts } from '../tracking/reference-foreign-key-facts';
import { snapshotValuesEqual } from '../tracking/snapshot-value-equality';
import type { IncludeLoaderContext } from './include-loader-context';

/** True when an ordinary tracking include would erase unsaved graph intent. */
export function includeNavigationHasPendingIntent(
    ctx: IncludeLoaderContext,
    entity: object,
    navigationProperty: string,
    relationship?: RelationshipKeyMetadata,
): boolean {
    if (!ctx.preservePendingRelationships) return false;
    const entry = ctx.changeTracker.entry(entity);
    if (!entry) return false;
    const snapshot = navigationSnapshot(entry, navigationProperty);
    const current = (entity as Record<string, unknown>)[navigationProperty];
    if (
        snapshot.known &&
        navigationValueChanged(snapshot.value, current)
    ) return true;
    if (!relationship) return false;
    const facts = captureReferenceForeignKeyFacts(entry, relationship);
    return relationship.foreignKeyProperties.some(property =>
        !snapshotValuesEqual(
            facts.boundValues[property],
            entry.originalBoundValues[property],
        ));
}

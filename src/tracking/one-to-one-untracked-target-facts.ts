import type { EntityMetadata } from '../model/entity-metadata';
import { readPropertyValue } from '../model/property-value-access';
import { capturePropertyPersistenceFact } from './entity-persistence-fact-capture';
import type { RelationshipDetectionValues } from './relationship-detection-values';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';

type PrincipalFacts = Readonly<Record<string, unknown>>;
type RelationshipFacts = WeakMap<TrackedRelationshipMetadata, PrincipalFacts>;

const factsByDetection: WeakMap<
    RelationshipDetectionValues,
    WeakMap<object, RelationshipFacts>
> = new WeakMap();

/** Capture an untracked principal's provider facts once per detection pass. */
export function untrackedPrincipalTargetFacts(
    metadata: EntityMetadata<Record<string, unknown>>,
    relationship: TrackedRelationshipMetadata,
    principal: object,
    captured: RelationshipDetectionValues,
): PrincipalFacts {
    let byPrincipal = factsByDetection.get(captured);
    if (!byPrincipal) {
        byPrincipal = new WeakMap();
        factsByDetection.set(captured, byPrincipal);
    }
    let byRelationship = byPrincipal.get(principal);
    if (!byRelationship) {
        byRelationship = new WeakMap();
        byPrincipal.set(principal, byRelationship);
    }
    const cached = byRelationship.get(relationship);
    if (cached) return cached;
    const properties = new Set(
        relationship.principalKeyProperties ?? metadata.keyProperties,
    );
    if (typeof metadata.tenantKeyProperty === 'string') {
        properties.add(metadata.tenantKeyProperty);
    }
    const facts = Object.fromEntries([...properties].map(propertyName => {
        const property = metadata.getProperty(propertyName);
        return [
            propertyName,
            capturePropertyPersistenceFact(
                metadata, property, readPropertyValue(principal, property),
            ).boundValue,
        ];
    }));
    byRelationship.set(relationship, facts);
    return facts;
}

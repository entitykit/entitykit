import type { EntityMetadata } from '../model/entity-metadata';
import { trackingIdentityKeyForBoundValues } from '../tracking/tracking-identity-key';

/** Identities belong to one buffered result graph, without change snapshots. */
export class QueryIdentityResolution {
    private readonly entities: Map<object, Map<string, object>> = new Map();

    public get<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        boundValues: Readonly<Record<string, unknown>>,
    ): TEntity | undefined {
        return this.entities.get(metadata)?.get(
            trackingIdentityKeyForBoundValues(metadata, boundValues),
        ) as TEntity | undefined;
    }

    public add<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        boundValues: Readonly<Record<string, unknown>>,
        entity: TEntity,
    ): void {
        let entities = this.entities.get(metadata);
        if (!entities) {
            entities = new Map();
            this.entities.set(metadata, entities);
        }
        const key = trackingIdentityKeyForBoundValues(metadata, boundValues);
        const existing = entities.get(key);
        if (existing && existing !== entity) {
            throw new Error(`Query identity collision for '${metadata.entityName}'.`);
        }
        entities.set(key, entity);
    }

    public clear(): void {
        this.entities.clear();
    }
}

const scopes: WeakMap<object, QueryIdentityResolution | undefined> = new WeakMap();

export function useQueryIdentityResolution<T extends object>(
    owner: T,
    identities: QueryIdentityResolution | undefined,
): T {
    scopes.set(owner, identities);
    return owner;
}

export function queryIdentityResolutionFor(owner: object): QueryIdentityResolution | undefined {
    return scopes.get(owner);
}

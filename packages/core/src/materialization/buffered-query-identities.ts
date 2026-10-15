import type { EntityMetadata } from '../model/entity-metadata';
import type { Model } from '../model/model';
import { isCompiledModelMetadata } from '../model/compiled-model';
import { trackingIdentityKeyForBoundValues } from '../tracking/tracking-identity-key';
import { QueryIdentityResolution } from './query-identity-resolution';
import {
    captureQueryIdentityProof, queryIdentityProofMatches,
    type QueryIdentityPlan, type QueryIdentityProof,
} from './query-identity-receipt';

interface QueryIdentityReceipt<TEntity extends object> {
    readonly proof: QueryIdentityProof;
    readonly key: string;
    readonly entity: TEntity | undefined;
}

/** Request-owned receipts; ordinary get/add keep their existing behavior. */
export class BufferedQueryIdentities extends QueryIdentityResolution {
    private duplicateMetadata?: Set<object>;

    public capture<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        boundValues: Readonly<Record<string, unknown>>,
        plan: QueryIdentityPlan,
    ): QueryIdentityReceipt<TEntity> | undefined {
        if (this.duplicateMetadata?.has(metadata)) return undefined;
        const entities = this.entities.get(metadata);
        if (!entities) return undefined;
        const proof = captureQueryIdentityProof(metadata, boundValues, plan);
        if (!proof) return undefined;
        const key = trackingIdentityKeyForBoundValues(metadata, boundValues);
        const entity = entities.get(key) as TEntity | undefined;
        if (entity) (this.duplicateMetadata ??= new Set()).add(metadata);
        return { proof, key, entity };
    }

    public addReceipt<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        boundValues: Readonly<Record<string, unknown>>,
        entity: TEntity,
        receipt: QueryIdentityReceipt<TEntity> | undefined,
    ): void {
        let entities = this.entities.get(metadata);
        if (!entities) {
            entities = new Map();
            this.entities.set(metadata, entities);
        }
        // Publish the current table before fallback encoding can reenter/clear.
        const key = receipt && queryIdentityProofMatches(receipt.proof, metadata, boundValues)
            ? receipt.key : trackingIdentityKeyForBoundValues(metadata, boundValues);
        const existing = entities.get(key);
        if (existing && existing !== entity) {
            throw new Error(`Query identity collision for '${metadata.entityName}'.`);
        }
        entities.set(key, entity);
    }

    public override clear(): void {
        super.clear();
        this.duplicateMetadata = undefined;
    }
}

export function createBufferedQueryIdentities(model: Model): QueryIdentityResolution {
    return isCompiledModelMetadata(model) ? new BufferedQueryIdentities() : new QueryIdentityResolution();
}

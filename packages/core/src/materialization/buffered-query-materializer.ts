import type { EntityMetadata } from '../model/entity-metadata';
import type { StoreValueReader } from '../storage/store-value-reader';
import type { ChangeTracker } from '../tracking/change-tracker';
import type { EntityEntry } from '../tracking/entity-entry';
import { Materializer } from './materializer';
import type { MaterializedRow } from './materialized-row';
import { queryIdentityResolutionFor, useQueryIdentityResolution, type QueryIdentityResolution } from './query-identity-resolution';
import { BufferedQueryIdentities } from './buffered-query-identities';
import { captureMaterializedValues } from './materialized-value-capture';
import { rememberMaterializedPersistenceFacts } from './materialized-bound-values';
import { queryIdentityPlan, type QueryIdentityPlan } from './query-identity-receipt';

/** Internal buffered execution; public/direct materializers retain row dispatch. */
class BufferedQueryMaterializer extends Materializer {
    public override materializeManyWithValues<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        rows: ReadonlyArray<Record<string, unknown>>,
        tracker: ChangeTracker,
    ): Array<MaterializedRow<TEntity>> {
        const identities = queryIdentityResolutionFor(this);
        const plan = identities instanceof BufferedQueryIdentities ? queryIdentityPlan(metadata) : undefined;
        if (!plan || !(identities instanceof BufferedQueryIdentities)) {
            return super.materializeManyWithValues(metadata, rows, tracker);
        }
        return rows.map(row => this.materializeBufferedRow(metadata, row, tracker, identities, plan));
    }

    private materializeBufferedRow<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        row: Record<string, unknown>,
        tracker: ChangeTracker,
        identities: BufferedQueryIdentities,
        plan: QueryIdentityPlan,
    ): MaterializedRow<TEntity> {
        const { values, boundValues } = captureMaterializedValues(metadata, row, this.valueReader);
        const receipt = identities.capture(metadata, boundValues, plan);
        const existing = receipt ? receipt.entity : identities.get(metadata, boundValues);
        if (existing) return { entity: existing, values, boundValues };
        const entity = this.createFreshEntity(metadata, values, tracker);
        rememberMaterializedPersistenceFacts(entity, metadata, values, boundValues);
        identities.addReceipt(metadata, boundValues, entity, receipt);
        return { entity, values, boundValues };
    }
}

export function createBufferedQueryMaterializer(
    reader: StoreValueReader | undefined,
    identities: QueryIdentityResolution | undefined,
    onFreshEntityTracked?: (entry: EntityEntry<object>) => void,
): Materializer {
    return useQueryIdentityResolution(identities instanceof BufferedQueryIdentities
        ? new BufferedQueryMaterializer(reader, onFreshEntityTracked)
        : new Materializer(reader, onFreshEntityTracked), identities);
}

import type { EntityMetadata } from '../model/entity-metadata';
import { isGeneratedOnAdd } from '../model/value-generated';
import { EntityState } from './entity-state';

/** Creates stable or temporary identity-map keys for newly tracked entities. */
export class TrackingIdentityFactory {
    private nextTemporaryIdentity = 1;

    public create<TEntity extends object>(
        entity: TEntity,
        metadata: EntityMetadata<TEntity>,
        state: EntityState,
    ): string {
        if (
            state === EntityState.Added &&
            metadata.keyPropertiesMetadata.some(property =>
                isGeneratedOnAdd(property.valueGenerated))
        ) {
            return `\0entitykit:${metadata.entityName}:${
                String(this.nextTemporaryIdentity++)
            }`;
        }
        return metadata.createIdentityKey(entity);
    }
}

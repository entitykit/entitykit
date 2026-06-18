import type { EntityConstructor } from '../../types';
import { EntityBuilderKeys } from '../entity-builder-keys';
import { EntityBuilderAlternateKeys } from '../entity-builder-alternate-keys';
import { EntityBuilderProperties } from '../entity-builder-properties';
import { EntityBuilderRelationships } from '../entity-builder-relationships';
import { EntityBuilderSaas } from '../entity-builder-saas';
import { EntityBuilderSchema } from '../entity-builder-schema';
import { EntityBuilderComplexProperties } from '../entity-builder-complex-properties';

export class EntityBuilderBase<TEntity extends object> {
    protected readonly propertiesFacet: EntityBuilderProperties<TEntity>;
    protected readonly keysFacet: EntityBuilderKeys<TEntity>;
    protected readonly alternateKeysFacet: EntityBuilderAlternateKeys<TEntity>;
    protected readonly relationshipsFacet: EntityBuilderRelationships<TEntity>;
    protected readonly saasFacet: EntityBuilderSaas<TEntity>;
    protected readonly schemaFacet: EntityBuilderSchema;
    protected readonly complexPropertiesFacet:
    EntityBuilderComplexProperties<TEntity>;

    constructor(protected readonly ctor: EntityConstructor<TEntity>) {
        this.propertiesFacet = new EntityBuilderProperties(ctor);
        this.keysFacet = new EntityBuilderKeys(ctor, this.propertiesFacet);
        this.alternateKeysFacet = new EntityBuilderAlternateKeys(
            ctor,
            this.propertiesFacet,
        );
        this.relationshipsFacet = new EntityBuilderRelationships(ctor);
        this.saasFacet = new EntityBuilderSaas(ctor, this.propertiesFacet);
        this.schemaFacet = new EntityBuilderSchema();
        this.complexPropertiesFacet = new EntityBuilderComplexProperties(
            ctor,
            this.propertiesFacet,
        );
    }
}

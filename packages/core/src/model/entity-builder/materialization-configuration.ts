import type { EntityMaterializer } from '../../types';
import type { CheckedEntityMaterializer } from '../checked-materialization-types';
import { EntityRelationshipConfiguration } from './relationship-configuration';

/** Select one rehydration policy independently of domain creation. */
export class EntityMaterializationConfiguration<TEntity extends object> extends EntityRelationshipConfiguration<TEntity> {
    protected materializer?: EntityMaterializer<TEntity>;
    protected checkedMaterializer?: CheckedEntityMaterializer<TEntity>;

    public materialize(factory: EntityMaterializer<TEntity>): this {
        this.materializer = factory;
        this.checkedMaterializer = undefined;
        return this;
    }

    public materializeChecked(factory: CheckedEntityMaterializer<TEntity>): this {
        this.checkedMaterializer = factory;
        this.materializer = undefined;
        return this;
    }
}

import type { EntityConstructor } from '../../types';
import type {
    ManyToManyRelationshipBuilder,
    RelationshipBuilder,
} from '../relationship-builder-types';
import type { PropertySelector } from '../model-property-selector';
import { EntitySaasConfiguration } from './saas-configuration';

export class EntityRelationshipConfiguration<TEntity extends object>
    extends EntitySaasConfiguration<TEntity> {
    public hasOne<TPrincipal extends object, TNavigation>(
        principalEntity: EntityConstructor<TPrincipal>,
        navigationSelector: PropertySelector<TEntity, TNavigation>,
    ): RelationshipBuilder<TEntity, TPrincipal> {
        return this.relationshipsFacet.hasOne(principalEntity, navigationSelector);
    }

    public hasManyToMany<TTarget extends object, TNavigation>(
        targetEntity: EntityConstructor<TTarget>,
        navigationSelector: PropertySelector<TEntity, TNavigation>,
    ): ManyToManyRelationshipBuilder<TTarget> {
        return this.relationshipsFacet.hasManyToMany(
            targetEntity, navigationSelector,
        );
    }
}

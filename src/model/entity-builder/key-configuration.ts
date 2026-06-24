import type { EntityPropertyKey } from '../../types';
import type { IndexBuilder, AlternateKeyBuilder } from '../index-builder-types';
import type { PropertyListSelector } from '../model-property-selector';
import { EntityPropertyConfiguration } from './property-configuration';

export class EntityKeyConfiguration<TEntity extends object>
    extends EntityPropertyConfiguration<TEntity> {
    public hasKey(
        propertyOrSelector: EntityPropertyKey<TEntity> | PropertyListSelector<TEntity>,
    ): this {
        this.keysFacet.key(propertyOrSelector);
        return this;
    }

    public hasAlternateKey(
        propertyOrSelector: EntityPropertyKey<TEntity> | PropertyListSelector<TEntity>,
    ): AlternateKeyBuilder {
        return this.alternateKeysFacet.alternateKey(propertyOrSelector);
    }

    public hasIndex(
        propertyOrSelector: EntityPropertyKey<TEntity> | PropertyListSelector<TEntity>,
    ): IndexBuilder<TEntity> {
        return this.keysFacet.index(propertyOrSelector);
    }

    public hasExpressionIndex(
        expressionOrExpressions: string | readonly string[],
    ): IndexBuilder<TEntity> {
        return this.keysFacet.expressionIndex(expressionOrExpressions);
    }
}

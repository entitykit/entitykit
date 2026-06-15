import type { EntityConstructor } from '../types';
import type { EntityBuilder } from './entity-builder-types';

/** Configuration for entity type. */ export interface EntityTypeConfiguration<TEntity extends object> {
    /** The entity. */ readonly entity: EntityConstructor<TEntity>;
    /** Perform the configure operation. */ configure(builder: EntityBuilder<TEntity>): void;
}

/** Configuration for base entity. */ export abstract class BaseEntityConfiguration<TEntity extends object>
implements EntityTypeConfiguration<TEntity> {
    /** The entity. */ public abstract readonly entity: EntityConstructor<TEntity>;

    /** Perform the configure operation. */ public configure(builder: EntityBuilder<TEntity>): void {
        void builder;
        // Derived configurations may call super.configure(builder) for shared conventions.
    }
}

export interface AnyEntityTypeConfiguration {
    /** The entity. */ readonly entity: EntityConstructor<object>;
    /** Perform the configure operation. */ configure(builder: never): void;
}

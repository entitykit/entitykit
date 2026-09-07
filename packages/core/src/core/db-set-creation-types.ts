/** A public constructor used for new entities, separate from entity identity. */
export type EntityCreationConstructor = new (...arguments_: never[]) => object;

/** A synchronous domain factory; its parameters define the creation contract. */
export type EntityCreationFactory<TEntity extends object = object> =
    (...arguments_: never[]) => TEntity;

/** Bind a domain factory to the returned set without changing other sets. */
export interface DbSetCreationOptions<TFactory extends EntityCreationFactory> {
    /** Construct a fresh entity. Reads never invoke this factory. */
    readonly create: TFactory;
}

/** Preserve the entity result even for erased never[] constructor/factory signatures. */
export type EntityCreationResult<TCreation extends EntityCreationConstructor | EntityCreationFactory> =
    TCreation extends new (...arguments_: never[]) => infer TEntity
        ? Extract<TEntity, object>
        : TCreation extends (...arguments_: never[]) => infer TEntity
            ? Extract<TEntity, object>
            : never;

/* eslint @typescript-eslint/no-invalid-void-type: ["error", { "allowAsThisParameter": true }] -- Factories declare their unbound receiver. */
/** Annotate a public constructor with its argument tuple, or use satisfies to retain inference. */
export type EntityCreationConstructor<
    TEntity extends object = object, TArguments extends unknown[] = never,
> = new (...arguments_: TArguments) => TEntity;

/** An unbound domain factory; annotate its argument tuple or use satisfies to retain inference. */
export type EntityCreationFactory<
    TEntity extends object = object, TArguments extends unknown[] = never,
> = (this: void, ...arguments_: TArguments) => TEntity;

/** Internal callable constraint; an erased signature does not establish creation arguments. */
export type EntityCreationFunction<TEntity extends object = object> =
    (this: void, ...arguments_: never) => TEntity;

/** Bind a domain factory to the returned set without changing other sets. */
export interface DbSetCreationOptions<TFactory extends EntityCreationFunction> {
    /** Construct a fresh entity. Reads never invoke this factory. */
    readonly create: TFactory;
}

/** Preserve entity results without the any fallback of ReturnType for erased signatures. */
export type EntityCreationResult<TCreation extends EntityCreationConstructor | EntityCreationFunction> =
    TCreation extends new (...arguments_: never) => infer TEntity
        ? Extract<TEntity, object>
        : TCreation extends (...arguments_: never) => infer TEntity
            ? Extract<TEntity, object>
            : never;

/** Require arguments shared by every possible signature; erased tuples do not permit calls. */
export type EntityCreationArguments<TCreation extends EntityCreationConstructor | EntityCreationFunction> =
    [TCreation] extends [new (...arguments_: infer TArguments) => object]
        ? KnownCreationArguments<TArguments>
        : [TCreation] extends [(...arguments_: infer TArguments) => object]
            ? KnownCreationArguments<TArguments>
            : never;

type KnownCreationArguments<TArguments extends unknown[]> =
    number extends TArguments['length']
        ? [TArguments[number]] extends [never] ? never : TArguments
        : TArguments;

/** Runtime identity for an entity class without constraining its constructor. */
export interface EntityConstructor<TEntity extends object> {
    /** Stable name for this contract or database object. */ readonly name: string;
    /** The prototype. */ readonly prototype: TEntity;
}

/** Mapped model values supplied while rehydrating an entity from a row. */
export type EntityMaterializationValues<TEntity extends object> =
    Readonly<Partial<TEntity>>;

/** Creates an entity instance from mapped values read from the database. */
export type EntityMaterializer<TEntity extends object> = (
    values: EntityMaterializationValues<TEntity>,
) => TEntity;

/** Public type representing entity property key. */ export type EntityPropertyKey<TEntity extends object> = Extract<keyof TEntity, string>;

/** Public type representing entity update value. */ export type EntityUpdateValue<TValue> =
    NonNullable<TValue> extends
        | Date
        | readonly unknown[]
        | Uint8Array
        | ((...args: never[]) => unknown)
        ? TValue
        : NonNullable<TValue> extends object
            ? EntityUpdateValues<NonNullable<TValue>> |
                Extract<TValue, null | undefined>
            : TValue;

/** Recursive partial values accepted by set-based updates. */
export type EntityUpdateValues<TEntity extends object> = {
    [K in keyof TEntity]?: EntityUpdateValue<TEntity[K]>;
};

import type { PropertyPathSelector } from './model-property-selector';

/** A synchronous check for a non-null model value, after provider conversion. */
export type MaterializationGuard<TValue> = (value: unknown) => value is TValue;

/** Scalar representation only; brands, literals, and custom objects need a guard. */
export type MaterializationScalar<TValue> =
    TValue extends string ? string :
        TValue extends number ? number :
            TValue extends boolean ? boolean :
                TValue extends bigint ? bigint :
                    TValue extends Date ? Date :
                        TValue extends Uint8Array ? Uint8Array : unknown;

/** Checked access to mapped scalar values. This is not an entity instance. */
export interface EntityMaterializationRow<TEntity extends object> {
    /** Require a present, non-null value matching a supported scalar mapping. */
    required<TValue>(selector: PropertyPathSelector<TEntity, TValue>): MaterializationScalar<NonNullable<TValue>>;
    /** Require a present, non-null value accepted by an explicit model-value guard. */
    required<TValue>(selector: PropertyPathSelector<TEntity, TValue>, guard: MaterializationGuard<NoInfer<NonNullable<TValue>>>): NonNullable<TValue>;
    /** Read a present scalar or SQL NULL. NULL requires a nullable mapping. */
    nullable<TValue>(selector: PropertyPathSelector<TEntity, TValue>): MaterializationScalar<NonNullable<TValue>> | null;
    /** Check a present model value, allowing SQL NULL only for a nullable mapping. */
    nullable<TValue>(selector: PropertyPathSelector<TEntity, TValue>, guard: MaterializationGuard<NoInfer<NonNullable<TValue>>>): NonNullable<TValue> | null;
}

/** Construct a fresh entity synchronously, checking requested scalars; mapped values are assigned afterward. */
export type CheckedEntityMaterializer<TEntity extends object> = (
    row: EntityMaterializationRow<TEntity>,
) => TEntity;

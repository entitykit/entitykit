import type { DbSet } from './db-set-types';
import type {
    EntityCreationArguments,
    EntityCreationConstructor,
    EntityCreationFunction,
    EntityCreationResult,
} from './db-set-creation-types';

/**
 * Annotate a set from its constructor or unbound factory, preserving create().
 * Pass a key tuple when find() needs explicit key types. For application-local
 * sets, prefer Context["property"] to preserve the exact mapped entity type too.
 */
export type DbSetFor<
    TCreation extends EntityCreationConstructor | EntityCreationFunction,
    TKey extends readonly unknown[] = readonly unknown[],
> = [Extract<EntityCreationResult<TCreation>, PromiseLike<unknown>>] extends [never]
    ? DbSet<EntityCreationResult<TCreation>, TKey, EntityCreationArguments<TCreation>>
    : never;

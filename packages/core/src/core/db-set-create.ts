import type { EntityConstructor } from '../types';
import type { EntityMetadata } from '../model/entity-metadata';
import { assertSynchronousCallbackResult } from '../synchronous-callback';
import type { DbSetContext } from './db-set-context';
import type { DbSetCreationOptions, EntityCreationConstructor, EntityCreationFunction } from './db-set-creation-types';
import { addDbSetEntity } from './db-set-add';

/** Read and validate a binding once, before it can affect any set. */
export function dbSetCreationFactory<TEntity extends object>(
    options?: DbSetCreationOptions<EntityCreationFunction<TEntity>>,
): EntityCreationFunction<TEntity> | undefined {
    if (options === undefined) return undefined;
    const factory = options.create;
    if (typeof factory !== 'function') {
        throw new TypeError('DbSet creation options must provide a create function.');
    }
    return factory;
}

/** Construct once, validate the result, and enroll through the ordinary add path. */
export function createDbSetEntity<TEntity extends object>(
    context: DbSetContext,
    metadata: EntityMetadata<TEntity>,
    entityType: EntityConstructor<TEntity>,
    factory: EntityCreationFunction<TEntity> | undefined,
    arguments_: unknown[],
): TEntity {
    // This guard checks initialization and disposal without executing a command.
    context.assertCanQuery('create()');
    metadata.assertWritable('create()');
    const created: unknown = factory
        ? Reflect.apply(factory, undefined, arguments_)
        : Reflect.construct(entityType as unknown as EntityCreationConstructor, arguments_);
    const operation = `Entity creation for '${metadata.entityName}'`;
    assertSynchronousCallbackResult(created, operation, message => new TypeError(message));
    if (created === null || typeof created !== 'object' ||
        !Object.prototype.isPrototypeOf.call(entityType.prototype, created)) {
        throw new TypeError(`${operation} must return an instance of the entity type.`);
    }
    if (context.changeTracker.entry(created)) {
        throw new TypeError(`${operation} must return a fresh, untracked entity.`);
    }
    return addDbSetEntity(context, metadata, created as TEntity).entity;
}

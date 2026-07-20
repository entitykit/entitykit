import { EntityNotFoundError } from '../errors/query-errors';
import type { EntityMetadata } from '../model/entity-metadata';
import { FieldExpression } from '../query/expression/field-expression';
import type { Queryable } from '../query/queryable';
import type { DatabaseOperationOptions, QueryStreamOptions } from '../storage/database-connection';

/** Primary-key lookup and terminal reads shared by every `DbSet`. */
export abstract class DbSetQueryTerminals<TEntity extends object> {
    /** Metadata for the entity this set reads. Provided by the concrete `DbSet`. */
    public abstract get metadata(): EntityMetadata<TEntity>;

    /** A fresh queryable bound to the concrete `DbSet` as its query executor. */
    protected abstract query(): Queryable<TEntity>;

    /**
   * Find an entity by its configured primary key.
   *
   * For a composite key, pass one value per key property in the order the key
   * was declared.
   */
    // `async` so an arity mistake rejects rather than throwing synchronously from
    // a Promise-returning method, which `.catch(...)` would not see.
    public async find(...arguments_: readonly unknown[]): Promise<TEntity | null> {
        if (this.metadata.isKeyless) {
            throw new Error(
                `find() is not supported for keyless entity '${this.metadata.entityName}'. Query it with where(), first(), or singleOrNull().`,
            );
        }
        const keyProperties = this.metadata.keyProperties;
        const { keyValues, options } = findArguments(keyProperties.length, arguments_);
        if (keyValues.length !== keyProperties.length) {
            throw new Error(
                `find() on '${this.metadata.entityName}' expects ${String(keyProperties.length)} key ${keyProperties.length === 1 ? 'value' : 'values'} (${keyProperties.join(', ')}), but received ${String(keyValues.length)}.`,
            );
        }

        return this.query()
            .where(() =>
                keyProperties
                    .map((propertyName, index) =>
                        new FieldExpression<TEntity, unknown>(propertyName).eq(
                            keyValues[index],
                        ),
                    )
                    .reduce((left, right) => left.and(right)),
            )
            .firstOrNull(options);
    }

    /** Find an entity by primary key or throw `EntityNotFoundError`. */
    public async findOrThrow(...arguments_: readonly unknown[]): Promise<TEntity> {
        const entity = await this.find(...arguments_);
        if (!entity) {
            throw new EntityNotFoundError(this.metadata.entityName, 'find');
        }
        return entity;
    }

    public async toArray(options?: DatabaseOperationOptions): Promise<TEntity[]> {
        return this.query().toArray(options);
    }

    public stream(options?: QueryStreamOptions): AsyncIterable<TEntity> {
        return this.query().stream(options);
    }

    public async firstOrNull(options?: DatabaseOperationOptions): Promise<TEntity | null> {
        return this.query().firstOrNull(options);
    }

    public async first(options?: DatabaseOperationOptions): Promise<TEntity> {
        return this.query().first(options);
    }

    public async single(options?: DatabaseOperationOptions): Promise<TEntity> {
        return this.query().single(options);
    }

    public async singleOrNull(options?: DatabaseOperationOptions): Promise<TEntity | null> {
        return this.query().singleOrNull(options);
    }

    public async count(options?: DatabaseOperationOptions): Promise<number> {
        return this.query().count(options);
    }

    public async exists(options?: DatabaseOperationOptions): Promise<boolean> {
        return this.query().exists(options);
    }

}

function findArguments(
    keyCount: number,
    arguments_: readonly unknown[],
): { readonly keyValues: readonly unknown[]; readonly options?: DatabaseOperationOptions } {
    const candidate = arguments_.at(-1);
    if (arguments_.length === keyCount + 1 && isOperationOptions(candidate)) {
        return { keyValues: arguments_.slice(0, -1), options: candidate };
    }
    return { keyValues: arguments_ };
}

function isOperationOptions(value: unknown): value is DatabaseOperationOptions {
    if (value === null || typeof value !== 'object') return false;
    const signal = (value as { readonly signal?: unknown }).signal;
    return signal === undefined || signal !== null
        && typeof signal === 'object'
        && typeof (signal as AbortSignal).aborted === 'boolean'
        && typeof (signal as AbortSignal).addEventListener === 'function';
}

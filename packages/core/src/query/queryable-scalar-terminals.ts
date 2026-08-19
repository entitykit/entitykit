import { ProviderCapabilityError } from '../errors/runtime-errors';
import type { DatabaseOperationOptions } from '../storage/database-connection';
import { QueryableBase } from './queryable-base';

/** Scalar terminal operations shared by entity queryables. */
export abstract class QueryableScalarTerminals<
    TEntity extends object,
> extends QueryableBase<TEntity> {
    public async count(options?: DatabaseOperationOptions): Promise<number> {
        return this.executor.executeCount(this.toQueryModel(), options);
    }

    public async countBigInt(
        options?: DatabaseOperationOptions,
    ): Promise<bigint> {
        if (!this.executor.executeCountBigInt) {
            throw new ProviderCapabilityError('countBigInt()');
        }
        return this.executor.executeCountBigInt(this.toQueryModel(), options);
    }

    public async exists(options?: DatabaseOperationOptions): Promise<boolean> {
        return this.executor.executeExists(this.toQueryModel(), options);
    }
}

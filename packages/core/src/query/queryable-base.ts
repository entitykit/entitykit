import { QueryableOrdering } from './queryable-ordering';

export abstract class QueryableBase<
    TEntity extends object,
> extends QueryableOrdering<TEntity> {}

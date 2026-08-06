export interface MaterializedRow<TEntity extends object = object> {
    readonly entity: TEntity;
    readonly values: Readonly<Record<string, unknown>>;
}

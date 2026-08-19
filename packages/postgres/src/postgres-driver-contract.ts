export interface PostgresQueryResult<
    TRow extends Record<string, unknown>,
> {
    readonly rows: TRow[];
    readonly rowCount: number | null;
}

export interface PoolClient {
    query<TRow extends Record<string, unknown> = Record<string, unknown>>(
        text: string,
        values?: readonly unknown[],
    ): Promise<PostgresQueryResult<TRow>>;
    release(error?: boolean | Error): void;
}

export interface Pool extends PoolClient {
    connect(): Promise<PoolClient>;
    end(): Promise<void>;
    on(event: 'error', listener: (error: Error) => void): unknown;
}

export interface PgModule {
    readonly Pool: new (config: Record<string, unknown>) => Pool;
}

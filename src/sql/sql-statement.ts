import { postgresDialect, type SqlDialect } from './sql-dialect';
import { isPromiseLike } from '../promise-like';

/** Public contract for sql statement. */ export interface SqlStatement {
    /** The text. */ readonly text: string;
    /** Bound values kept separate from SQL text. */ readonly values: readonly unknown[];
    /** The suppress transaction. */ readonly suppressTransaction?: boolean;
}

export class SqlParameterBag {
    private readonly parameterValues: unknown[] = [];

    constructor(private readonly dialect: SqlDialect = postgresDialect) {}

    public get values(): readonly unknown[] {
        return [...this.parameterValues];
    }

    public add(value: unknown): string {
        if (isPromiseLike(value)) {
            void Promise.resolve(value).catch(() => undefined);
            throw new TypeError(
                'SQL parameters cannot be Promises. Await the value before constructing the query.',
            );
        }
        if (value instanceof Date && Number.isNaN(value.getTime())) {
            throw new TypeError('SQL parameters cannot contain an invalid Date.');
        }
        this.parameterValues.push(value);

        // Every statement EntityKit builds passes through here, so one check
        // covers reads, writes, and bulk operations alike. Without it the provider
        // rejects the statement at the wire protocol, with an error that names
        // neither the limit nor the fix — and at a different size on each provider.
        const limit = this.dialect.maxStatementParameters?.();
        if (limit !== undefined && this.parameterValues.length > limit) {
            throw new Error(
                `Statement needs more than ${String(limit)} bound parameters, which is the most ${this.dialect.name} accepts. ` +
        'Filter against a joined table or a temporary table instead of a very large in([...]) list.',
            );
        }

        return this.dialect.parameter(this.parameterValues.length);
    }
}

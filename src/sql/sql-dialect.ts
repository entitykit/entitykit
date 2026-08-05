import type { SchemaSqlDialect } from './schema-sql-dialect';

export type { AlterColumnChange } from './alter-column-change';
export type { SchemaSqlDialect, SqlSequenceDefinition } from './schema-sql-dialect';
export { postgresDialect } from './postgres-dialect';
export { quoteIdentifier, quoteQualifiedIdentifier } from './postgres-identifiers';

/** Provider-neutral SQL rendering capabilities used by query and write compilation. */
export interface SqlDialect extends SchemaSqlDialect {
    /** Stable name for this contract or database object. */ readonly name: string;
    /**
   * Clause this provider needs appended to an `order by` term so that nulls
   * sort as SQL-standard — greater than any non-null value, so last ascending
   * and first descending.
   *
   * Providers whose default already matches return an empty string. Providers
   * that cannot express it also return an empty string and order nulls their
   * own way, which is a documented parity gap rather than a silent one.
   */
    nullOrderingClause?(direction: 'asc' | 'desc'): string;
    /**
   * A term prepended to an `order by` column to place nulls SQL-standard, for
   * a provider that cannot express it as a trailing keyword.
   *
   * MySQL has no `NULLS LAST`, so it sorts on a leading `(col is null)` term
   * instead. Providers that use `nullOrderingClause` return nothing here.
   */
    nullOrderingPrefix?(columnExpr: string, direction: 'asc' | 'desc'): string;
    /**
   * Literal this provider needs as a limit when an offset is used without one,
   * or `undefined` when a bare offset is valid.
   *
   * SQLite and MySQL reject `offset` without `limit`; Postgres accepts it.
   * Without this, `skip(n)` with no `take(...)` works on one provider and fails
   * on the others.
   */
    unlimitedLimitLiteral?(): string | undefined;
    /**
   * Most bound parameters this provider accepts in one statement, or
   * `undefined` when it has no practical cap.
   *
   * A multi-row insert is one statement, so without this a large save is
   * built past the provider's limit and rejected with a protocol-level error
   * that names neither the limit nor the fix — and at a different row count on
   * each provider, so the same save works on one and fails on the other.
   */
    maxStatementParameters?(): number | undefined;
    /**
   * Whether this provider can evaluate a `row_number() over (partition by ...
   * order by ...)` window, which the filtered-include loaders use to page each
   * parent's children to their own `take`/`skip` in a single query.
   *
   * Postgres, SQLite (>= 3.25), and MySQL (>= 8.0) all can, and the shipped
   * drivers target those versions. A provider that omits this — or returns
   * false — keeps the per-parent fallback: one query per parent, slower but
   * correct on any SQL engine, so an unknown provider is never handed a window
   * it cannot run.
   */
    supportsWindowFunctions?(): boolean;
    /**
   * Cast the operand of an `avg(...)` so the average is computed in floating
   * point, or absent to average the column as-is.
   *
   * MySQL's `AVG` of an integer column returns a `DECIMAL` truncated to a few
   * decimal places (`div_precision_increment`) — and in a `group by` query even
   * casting the result to `double` does not recover the lost digits, because the
   * truncation happens first. Averaging the column *cast to double* keeps full
   * precision, matching Postgres `numeric` and SQLite `double`, so the same
   * average is `10.333333333333334` everywhere rather than `10.3333` on MySQL.
   * `avg` is the only aggregate that needs it: `sum` stays exact and `min`/`max`
   * keep the column's own type.
   */
    avgOperand?(columnSql: string): string;
    /** Provider spelling for concatenating text operands. Defaults to `||`. */
    stringConcatExpression?(operands: readonly string[]): string;
    /** Provider spelling for character length. Defaults to `length(...)`. */
    stringLengthExpression?(operand: string): string;
    /** Perform the quote identifier operation. */ quoteIdentifier(identifier: string): string;
    /** Perform the quote qualified identifier operation. */ quoteQualifiedIdentifier(...identifiers: ReadonlyArray<string | undefined>): string;
    /** Perform the parameter operation. */ parameter(index: number): string;
    /** Cast a bound JSON value for equality/membership comparisons when needed. */
    jsonComparisonParameter?(parameterSql: string): string;
    /** Perform the count all expression operation. */ countAllExpression(): string;
    /** Optional full-width row-count expression for count terminal queries. */
    countRowsExpression?(): string;
    /** Perform the false predicate operation. */ falsePredicate(): string;
    /**
   * The clause that makes an insert a no-op on a key conflict. `columns` are the
   * inserted columns: Postgres and SQLite ignore them (`on conflict do nothing`),
   * but MySQL's `on duplicate key update` needs a real column to self-assign, and
   * a join table has no `id`.
   */
    insertConflictDoNothingClause(columns: readonly string[]): string;
    /** Provider clause returning generated columns; absent triggers a refresh. */
    returningClause?(columns: readonly string[]): string | undefined;
    /** Provider spelling for an all-generated insert; default is `default values`. */
    defaultValuesInsertClause?(): string;
    /**
   * The clause that turns an insert into an upsert, or `undefined` for a
   * provider that cannot express one.
   *
   * Postgres and SQLite both spell this `on conflict (...) do update set c =
   * excluded.c`, but the seam is here rather than in shared code because other
   * providers do not — MySQL writes `on duplicate key update c = values(c)`,
   * and some cannot do it at all. A provider that returns `undefined` gets a
   * clear capability error instead of SQL it will reject.
   */
    upsertClause?(conflictColumns: readonly string[], updateColumns: readonly string[]): string | undefined;
    /** Whether any unique key can trigger upsert; absent means only the specified target can. */
    readonly upsertConflictTarget?: 'specified' | 'anyUnique';
    /**
   * Translate a model's declared column type into this provider's DDL type, or
   * `undefined`/absent to use it verbatim.
   *
   * The model declares provider-neutral types like `timestamptz` and `jsonb`.
   * SQLite is untyped and Postgres accepts those names directly, so neither
   * needs this. MySQL rejects them — and rejects `text` as a key — so it maps
   * them to its own types. `isKey` is set for a column that is part of a
   * primary key or a key it references, where MySQL needs a bounded type.
   */
    mapColumnType?(type: string, options: {
        readonly isKey: boolean;
        readonly collation?: string;
    }): string;
}

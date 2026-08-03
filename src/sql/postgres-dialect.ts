import type { SqlDialect, SqlSequenceDefinition } from './sql-dialect';
import type { StoreGenerationStrategy } from '../model/store-generation';
import { quoteIdentifier, quoteQualifiedIdentifier } from './postgres-identifiers';
import { alterPostgresStoreGeneration, postgresStoreGenerationClause } from './postgres-store-generation';

/** Built-in postgres dialect. */ export const postgresDialect: SqlDialect = Object.freeze({
    name: 'postgres',
    maxStatementParameters(): number {
    // The wire protocol sends the parameter count as an unsigned 16-bit int.
        return 65535;
    },
    supportsWindowFunctions(): boolean {
    // Postgres has had window functions since 8.4 (2009).
        return true;
    },
    nullOrderingClause(): string {
    // Postgres already sorts nulls as greater than non-nulls.
        return '';
    },
    unlimitedLimitLiteral(): string | undefined {
    // Postgres accepts `offset` on its own.
        return undefined;
    },
    generatedColumnClause(expression: string, stored: boolean): string {
        if (!stored) {
            throw new Error('The Postgres provider supports stored generated columns only.');
        }
        return `generated always as (${expression}) stored`;
    },
    storeGenerationClause(
        strategy: StoreGenerationStrategy,
        column: { readonly type: string; readonly isPrimaryKey: boolean },
    ): string {
        return postgresStoreGenerationClause(strategy, column);
    },
    alterStoreGenerationStatements(
        table: string,
        column: string,
        current: StoreGenerationStrategy | undefined,
        previous: StoreGenerationStrategy | undefined,
        columnType: string,
    ): readonly string[] {
        return alterPostgresStoreGeneration(
            table,
            column,
            current,
            previous,
            columnType,
        );
    },
    indexExpression(expression: string): string {
        return expression;
    },
    indexIncludeClause(columns: readonly string[]): string {
        return ` include (${columns.join(', ')})`;
    },
    indexFilterClause(sql: string): string {
        return ` where ${sql}`;
    },
    createSequenceStatement(sequence: SqlSequenceDefinition): string {
        return `create sequence if not exists ${quoteQualifiedIdentifier(sequence.schemaName, sequence.name)}${sequenceOptions(sequence)}`;
    },
    alterSequenceStatement(sequence: SqlSequenceDefinition): string {
        return `alter sequence ${quoteQualifiedIdentifier(sequence.schemaName, sequence.name)}${completeSequenceOptions(sequence)}`;
    },
    dropSequenceStatement(sequence: SqlSequenceDefinition): string {
        return `drop sequence if exists ${quoteQualifiedIdentifier(sequence.schemaName, sequence.name)}`;
    },
    quoteIdentifier,
    quoteQualifiedIdentifier,
    parameter(index: number): string {
        return `$${String(index)}`;
    },
    countAllExpression(): string {
        return 'count(*)::int';
    },
    countRowsExpression: () => 'count(*)',
    falsePredicate(): string {
        return '1 = 0';
    },
    upsertClause(
        conflictColumns: readonly string[],
        updateColumns: readonly string[],
    ): string {
        const assignments = updateColumns
            .map(
                column =>
                    `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`,
            )
            .join(', ');
        return `on conflict (${conflictColumns
            .map(quoteIdentifier)
            .join(', ')}) do update set ${assignments}`;
    },
    insertConflictDoNothingClause(): string {
        return 'on conflict do nothing';
    },
    returningClause(columns: readonly string[]): string {
        return `returning ${columns.map(quoteIdentifier).join(', ')}`;
    },
});

function sequenceOptions(sequence: SqlSequenceDefinition): string {
    validateSequenceIntegers(sequence);
    return [
        sequence.dataType ? ` as ${sequence.dataType}` : '',
        sequence.incrementBy ? ` increment by ${sequence.incrementBy}` : '',
        sequence.minValue ? ` minvalue ${sequence.minValue}` : '',
        sequence.maxValue ? ` maxvalue ${sequence.maxValue}` : '',
        sequence.startValue ? ` start with ${sequence.startValue}` : '',
        sequence.cache ? ` cache ${String(sequence.cache)}` : '',
        sequence.isCyclic ? ' cycle' : ' no cycle',
    ].join('');
}

function completeSequenceOptions(sequence: SqlSequenceDefinition): string {
    validateSequenceIntegers(sequence);
    const increment = sequence.incrementBy ?? '1';
    const ascending = BigInt(increment) > 0n;
    const start = sequence.startValue ??
        (ascending ? sequence.minValue ?? '1' : sequence.maxValue ?? '-1');
    return [
        ` as ${sequence.dataType ?? 'bigint'}`,
        ` increment by ${increment}`,
        sequence.minValue
            ? ` minvalue ${sequence.minValue}`
            : ' no minvalue',
        sequence.maxValue
            ? ` maxvalue ${sequence.maxValue}`
            : ' no maxvalue',
        ` start with ${start}`,
        ` cache ${String(sequence.cache ?? 1)}`,
        sequence.isCyclic ? ' cycle' : ' no cycle',
    ].join('');
}

function validateSequenceIntegers(sequence: SqlSequenceDefinition): void {
    for (const value of [
        sequence.startValue,
        sequence.incrementBy,
        sequence.minValue,
        sequence.maxValue,
    ]) {
        if (value !== undefined && !/^-?\d+$/.test(value)) {
            throw new Error('Postgres sequence options must be integer literals.');
        }
    }
}

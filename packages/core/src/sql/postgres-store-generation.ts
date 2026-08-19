import type { StoreGenerationStrategy } from '../model/store-generation';
import { validateStoreGeneration } from '../model/store-generation';
import { quoteQualifiedIdentifier } from './postgres-identifiers';
import {
    assertPostgresIdentityType,
    completePostgresIdentityOptions,
    postgresIdentityOptions,
} from './postgres-identity-options';
export function postgresStoreGenerationClause(
    strategy: StoreGenerationStrategy,
    column: { readonly type: string },
): string {
    switch (strategy.kind) {
        case 'identity':
            assertPostgresIdentityType(column.type);
            return `generated ${strategy.mode === 'always' ? 'always' : 'by default'} as identity${postgresIdentityOptions(strategy)}`;
        case 'sequence':
            return `default nextval(${sequenceRegclass(strategy)})`;
        case 'autoIncrement':
        case 'rowid':
            throw new Error(
                `Store-generation strategy '${strategy.kind}' is not supported by the 'postgres' provider.`,
            );
    }
}
export function alterPostgresStoreGeneration(
    table: string,
    column: string,
    current: StoreGenerationStrategy | undefined,
    previous: StoreGenerationStrategy | undefined,
    columnType: string,
): string[] {
    for (const strategy of [current, previous]) {
        if (strategy) {
            validateStoreGeneration(strategy);
        }
    }
    assertPostgresStrategy(current);
    assertPostgresStrategy(previous);
    if (current?.kind === 'identity') {
        assertPostgresIdentityType(columnType);
    }
    if (previous?.kind === 'identity') {
        if (current?.kind !== 'identity') {
            return [
                `alter table ${table} alter column ${column} drop identity if exists`,
                ...setSequenceDefault(table, column, current),
            ];
        }
        return alterIdentity(table, column, current, previous);
    }
    if (current?.kind === 'identity') {
        return [
            ...previous?.kind === 'sequence'
                ? [`alter table ${table} alter column ${column} drop default`]
                : [],
            `alter table ${table} alter column ${column} add generated ${
                current.mode === 'always' ? 'always' : 'by default'
            } as identity${postgresIdentityOptions(current)}`,
        ];
    }
    return setSequenceDefault(table, column, current);
}

function alterIdentity(
    table: string,
    column: string,
    current: Extract<StoreGenerationStrategy, { kind: 'identity' }>,
    previous: Extract<StoreGenerationStrategy, { kind: 'identity' }>,
): string[] {
    const prefix = `alter table ${table} alter column ${column}`;
    const statements: string[] = [];
    if (current.mode !== previous.mode) {
        statements.push(`${prefix} set generated ${
            current.mode === 'always' ? 'always' : 'by default'
        }`);
    }
    const options = completePostgresIdentityOptions(current);
    if (options.join('\u0000') !== completePostgresIdentityOptions(previous).join('\u0000')) {
        statements.push(...options.map(option => `${prefix} set ${option}`));
    }
    return statements;
}

function setSequenceDefault(
    table: string,
    column: string,
    strategy: StoreGenerationStrategy | undefined,
): string[] {
    if (strategy?.kind === 'sequence') {
        return [
            `alter table ${table} alter column ${column} set default nextval(${sequenceRegclass(strategy)})`,
        ];
    }
    return [`alter table ${table} alter column ${column} drop default`];
}

function sequenceRegclass(
    strategy: Extract<StoreGenerationStrategy, { kind: 'sequence' }>,
): string {
    const identifier = quoteQualifiedIdentifier(
        strategy.schemaName,
        strategy.name,
    ).replace(/'/g, '\'\'');
    return `'${identifier}'::regclass`;
}

function assertPostgresStrategy(
    strategy: StoreGenerationStrategy | undefined,
): void {
    if (strategy && !['identity', 'sequence'].includes(strategy.kind)) {
        throw new Error(
            `Store-generation strategy '${strategy.kind}' is not supported by the 'postgres' provider.`,
        );
    }
}

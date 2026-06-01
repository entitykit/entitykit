import type { StoreGenerationStrategy } from '../model/store-generation';

type IdentityStrategy = Extract<
    StoreGenerationStrategy,
    { kind: 'identity' }
>;

export function assertPostgresIdentityType(type: string): void {
    const normalized = type.trim().toLowerCase();
    if (![
        'smallint', 'integer', 'bigint', 'int2', 'int4', 'int8',
    ].includes(normalized)) {
        throw new Error(
            'Postgres identity columns must use smallint, integer, or bigint.',
        );
    }
}

export function postgresIdentityOptions(strategy: IdentityStrategy): string {
    const options = [
        strategy.incrementBy ? `increment by ${strategy.incrementBy}` : undefined,
        strategy.minValue ? `minvalue ${strategy.minValue}` : undefined,
        strategy.maxValue ? `maxvalue ${strategy.maxValue}` : undefined,
        strategy.startValue ? `start with ${strategy.startValue}` : undefined,
        strategy.cache ? `cache ${String(strategy.cache)}` : undefined,
        strategy.isCyclic ? 'cycle' : undefined,
    ].filter((option): option is string => option !== undefined);
    return options.length > 0 ? ` (${options.join(' ')})` : '';
}

export function completePostgresIdentityOptions(
    strategy: IdentityStrategy,
): string[] {
    return [
        `increment by ${strategy.incrementBy ?? '1'}`,
        strategy.minValue ? `minvalue ${strategy.minValue}` : 'no minvalue',
        strategy.maxValue ? `maxvalue ${strategy.maxValue}` : 'no maxvalue',
        `start with ${strategy.startValue ?? defaultStart(strategy)}`,
        `cache ${String(strategy.cache ?? 1)}`,
        strategy.isCyclic ? 'cycle' : 'no cycle',
    ];
}

function defaultStart(strategy: IdentityStrategy): string {
    return BigInt(strategy.incrementBy ?? '1') > 0n ? '1' : '-1';
}

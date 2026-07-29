import {
    pureFacadeViolations,
    unexpectedConsumers,
} from './architecture-test-support';

interface FacadeRule {
    readonly facade: string;
    readonly scope?: string;
    readonly allowedConsumers?: readonly string[];
}

const facadeRules: readonly FacadeRule[] = [
    {
        facade: 'src/query/expression.ts',
        allowedConsumers: ['src/index.ts'],
    },
    { facade: 'src/cli/cli-output.ts' },
    {
        facade: 'src/core/db-context-options.ts',
        allowedConsumers: ['src/index.ts'],
    },
    {
        facade: 'src/query/joined-query.ts',
        allowedConsumers: ['src/index.ts', 'src/experimental/index.ts'],
    },
    {
        facade: 'src/diagnostics/runtime-diagnostics.ts',
        allowedConsumers: ['src/index.ts'],
    },
    {
        facade: 'src/model/value-converter.ts',
        allowedConsumers: ['src/index.ts'],
    },
    { facade: 'src/query/joined-query-helpers.ts' },
    {
        facade: 'src/model/model-snapshot.ts',
        allowedConsumers: ['src/index.ts'],
    },
    {
        facade: 'src/migrations/migration-discovery.ts',
        allowedConsumers: [
            'src/index.ts',
            'src/migrations/api.ts',
            'src/migrations/index.ts',
        ],
    },
    {
        facade: 'src/query/include-loader-helpers.ts',
        scope: 'src/query',
    },
    {
        facade: 'src/query/aggregate-field-types.ts',
        scope: 'src/query',
        allowedConsumers: ['src/query/aggregate.ts'],
    },
    {
        facade: 'src/query/aggregate-expressions.ts',
        scope: 'src/query',
    },
];

describe('compatibility facade boundaries', () => {
    it.each(facadeRules)('$facade contains re-exports only', ({ facade }) => {
        expect(pureFacadeViolations(facade)).toEqual([]);
    });

    it.each(facadeRules)(
        '$facade is not an internal dependency',
        ({ facade, scope = 'src', allowedConsumers = [] }) => {
            expect(unexpectedConsumers(facade, scope, allowedConsumers)).toEqual([]);
        },
    );
});

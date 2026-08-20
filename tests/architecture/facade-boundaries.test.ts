import {
    packageSourceFiles,
    pureFacadeViolations,
    sourceFiles,
    unexpectedConsumers,
} from './architecture-test-support';

interface FacadeRule {
    readonly facade: string;
    readonly scope?: string;
    readonly allowedConsumers?: readonly string[];
}

const facadeRules: readonly FacadeRule[] = [
    {
        facade: 'packages/core/src/query/expression.ts',
        allowedConsumers: ['packages/core/src/index.ts'],
    },
    { facade: 'packages/cli/src/cli-output.ts' },
    {
        facade: 'packages/core/src/core/db-context-options.ts',
        allowedConsumers: ['packages/core/src/index.ts'],
    },
    {
        facade: 'packages/core/src/query/joined-query.ts',
        allowedConsumers: ['packages/core/src/index.ts', 'packages/core/src/experimental/index.ts'],
    },
    {
        facade: 'packages/core/src/diagnostics/runtime-diagnostics.ts',
        allowedConsumers: ['packages/core/src/index.ts'],
    },
    {
        facade: 'packages/core/src/model/value-converter.ts',
        allowedConsumers: ['packages/core/src/index.ts'],
    },
    { facade: 'packages/core/src/query/joined-query-helpers.ts' },
    {
        facade: 'packages/core/src/model/model-snapshot.ts',
        allowedConsumers: ['packages/core/src/index.ts'],
    },
    {
        facade: 'packages/core/src/migrations/migration-discovery.ts',
        allowedConsumers: [
            'packages/core/src/index.ts',
            'packages/core/src/migrations/api.ts',
            'packages/core/src/migrations/index.ts',
        ],
    },
    {
        facade: 'packages/core/src/query/include-loader-helpers.ts',
        scope: 'packages/core/src/query',
    },
    {
        facade: 'packages/core/src/query/aggregate-field-types.ts',
        scope: 'packages/core/src/query',
        allowedConsumers: ['packages/core/src/query/aggregate.ts'],
    },
    {
        facade: 'packages/core/src/query/aggregate-expressions.ts',
        scope: 'packages/core/src/query',
    },
];

describe('compatibility facade boundaries', () => {
    it.each(facadeRules)('$facade contains re-exports only', ({ facade }) => {
        expect(pureFacadeViolations(facade)).toEqual([]);
    });

    it.each(facadeRules)(
        '$facade is not an internal dependency',
        ({ facade, scope, allowedConsumers = [] }) => {
            // Unscoped rules now sweep every package, not just core: a facade
            // stops being a compatibility shim the moment any package depends
            // on it internally.
            const files = scope === undefined ? packageSourceFiles() : sourceFiles(scope);
            expect(unexpectedConsumers(facade, files, allowedConsumers)).toEqual([]);
        },
    );
});

import vm from 'node:vm';
import ts from 'typescript';
import * as migrationsApi from '../../packages/core/src/migrations/api';
import type { Migration } from '../../packages/core/src/migrations/api';

/** Execute actual generated TypeScript against the public migration module. */
export function compiledMigration(source: string): Migration {
    const module: { exports: { default?: new () => Migration } } = { exports: {} };
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    vm.runInNewContext(compiled.outputText, {
        module, exports: module.exports,
        require: (name: string): typeof migrationsApi => {
            if (name !== '@entitykit/core/migrations') throw new Error(`Unexpected generated import ${name}.`);
            return migrationsApi;
        },
    }, { timeout: 1000 });
    const Constructor = module.exports.default;
    if (Constructor === undefined) throw new Error('Generated migration has no default export.');
    return new Constructor();
}

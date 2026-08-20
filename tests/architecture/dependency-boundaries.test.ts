import fs from 'node:fs';
import path from 'node:path';
import {
    importsFrom,
    readSource,
    repositoryRoot,
    sourceFiles,
} from './architecture-test-support';

describe('dependency boundaries', () => {
    it('keeps the model layer independent of outer layers', () => {
        const offenders = sourceFiles('packages/core/src/model').flatMap(file =>
            [
                'packages/core/src/core',
                'packages/core/src/query',
                'packages/core/src/sql',
                'packages/core/src/schema',
            ].flatMap(directory =>
                importsFrom(file, directory).map(target => `${file} -> ${target}`),
            ),
        );

        expect(offenders).toEqual([]);
    });

    it('keeps migrations independent of DbContext and the core layer', () => {
        const offenders = sourceFiles('packages/core/src/migrations').flatMap(file =>
            importsFrom(file, 'packages/core/src/core').map(target => `${file} -> ${target}`),
        );

        expect(offenders).toEqual([]);
    });

    it('keeps providers behind storage, SQL, model, and migration contracts', () => {
        // No whitelist: the application-facing Postgres helpers used to reach
        // straight into `src/query` and `src/sql`, and now name what they need
        // on a public core entry like every other cross-package import. The
        // rule reads the same for every provider file.
        const offenders = ['postgres', 'sqlite', 'mysql']
            .flatMap(provider => sourceFiles(`packages/${provider}/src`))
            .flatMap(file =>
                [
                    'packages/core/src/core',
                    'packages/core/src/query',
                    'packages/core/src/tracking',
                ].flatMap(directory =>
                    importsFrom(file, directory).map(target => `${file} -> ${target}`),
                ),
            );

        expect(offenders).toEqual([]);
    });

    it('keeps the shared type kernel independent', () => {
        const typeKernel = 'packages/core/src/types.ts';

        expect(fs.existsSync(path.join(repositoryRoot, typeKernel))).toBe(true);
        expect(fs.existsSync(path.join(repositoryRoot, 'packages/core/src/core/types.ts'))).toBe(false);
        expect(readSource(typeKernel)).not.toMatch(/^import /mu);
    });
});

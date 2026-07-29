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
        const offenders = sourceFiles('src/model').flatMap(file =>
            ['src/core', 'src/query', 'src/sql', 'src/schema'].flatMap(directory =>
                importsFrom(file, directory).map(target => `${file} -> ${target}`),
            ),
        );

        expect(offenders).toEqual([]);
    });

    it('keeps migrations independent of DbContext and the core layer', () => {
        const offenders = sourceFiles('src/migrations').flatMap(file =>
            importsFrom(file, 'src/core').map(target => `${file} -> ${target}`),
        );

        expect(offenders).toEqual([]);
    });

    it('keeps providers behind storage, SQL, model, and migration contracts', () => {
        const applicationFacingHelpers = new Set([
            'src/providers/postgres/index.ts',
            'src/providers/postgres/postgres-query-helpers.ts',
        ]);
        const offenders = sourceFiles('src/providers')
            .filter(file => !applicationFacingHelpers.has(file))
            .flatMap(file =>
                ['src/core', 'src/query', 'src/tracking'].flatMap(directory =>
                    importsFrom(file, directory).map(target => `${file} -> ${target}`),
                ),
            );

        expect(offenders).toEqual([]);
    });

    it('keeps the shared type kernel independent', () => {
        const typeKernel = 'src/types.ts';

        expect(fs.existsSync(path.join(repositoryRoot, typeKernel))).toBe(true);
        expect(fs.existsSync(path.join(repositoryRoot, 'src/core/types.ts'))).toBe(false);
        expect(readSource(typeKernel)).not.toMatch(/^import /mu);
    });
});

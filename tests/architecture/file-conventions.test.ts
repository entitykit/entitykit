import path from 'node:path';
import {
    oversizedFiles,
    sourceFiles,
} from './architecture-test-support';

describe('file conventions', () => {
    it('uses lowercase kebab-case names for TypeScript modules', () => {
        const invalid = [
            ...sourceFiles('src'),
            ...sourceFiles('tests'),
            ...sourceFiles('smoke'),
            ...sourceFiles('dogfood'),
        ].filter(file => path.basename(file, '.ts').split('.').some(
            part => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(part),
        ));

        expect(invalid).toEqual([]);
    });

    it('uses specific source module names instead of generic junk drawers', () => {
        const genericNames = new Set([
            'common.ts',
            'config.ts',
            'helpers.ts',
            'utils.ts',
        ]);
        const generic = sourceFiles('src')
            .filter(file => genericNames.has(path.basename(file)));

        expect(generic).toEqual([]);
    });

    it('keeps every source module within the project-wide size budget', () => {
        expect(oversizedFiles(sourceFiles('src'), 150)).toEqual([]);
    });

    it('keeps test and smoke modules within the project-wide size budget', () => {
        expect(oversizedFiles([
            ...sourceFiles('tests'),
            ...sourceFiles('smoke'),
            ...sourceFiles('dogfood'),
        ], 350)).toEqual([]);
    });
});

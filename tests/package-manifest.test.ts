import fs from 'node:fs';
import path from 'node:path';

interface PackageManifest {
    readonly private?: boolean;
    readonly type?: string;
    readonly main?: string;
    readonly types?: string;
    readonly files?: readonly string[];
    readonly bin?: Readonly<Record<string, string>>;
    readonly exports?: Readonly<Record<string, unknown>>;
    readonly scripts?: Readonly<Record<string, string>>;
    readonly peerDependenciesMeta?: Readonly<Record<
        string,
        { readonly optional?: boolean }
    >>;
}

describe('package manifest', () => {
    it('publishes only executable CommonJS artifacts and supported subpaths', () => {
        const manifest = JSON.parse(fs.readFileSync(
            path.join(process.cwd(), 'package.json'),
            'utf8',
        )) as PackageManifest;

        expect(manifest.private).not.toBe(true);
        expect(manifest.type).toBe('commonjs');
        expect(manifest.main).toBe('./dist/index.js');
        expect(manifest.types).toBe('./dist/index.d.ts');
        expect(manifest.files).toEqual(['dist']);
        expect(manifest.bin).toEqual({ entitykit: './dist/cli/index.js' });
        expect(Object.keys(manifest.exports ?? {}).sort()).toEqual([
            '.',
            './adapter',
            './cli',
            './experimental',
            './migrations',
            './mysql',
            './package.json',
            './postgres',
            './sqlite',
            './testing',
            './tooling',
        ]);
        expect(manifest.scripts).toMatchObject({
            build: 'node scripts/build-package.js',
            'check:package': 'node scripts/check-package.js',
        });
        expect(manifest.peerDependenciesMeta).toEqual({
            mysql2: { optional: true },
            pg: { optional: true },
        });
    });
});

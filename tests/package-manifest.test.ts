import fs from 'node:fs';
import path from 'node:path';
import { entityKitMigrationVersion } from '../src/migrations/migration-metadata';

interface PackageManifest {
    readonly version?: string;
    readonly description?: string;
    readonly author?: string;
    readonly license?: string;
    readonly repository?: Readonly<Record<string, string>>;
    readonly homepage?: string;
    readonly bugs?: Readonly<Record<string, string>>;
    readonly keywords?: readonly string[];
    readonly private?: boolean;
    readonly type?: string;
    readonly main?: string;
    readonly types?: string;
    readonly files?: readonly string[];
    readonly bin?: Readonly<Record<string, string>>;
    readonly publishConfig?: Readonly<Record<string, string>>;
    readonly exports?: Readonly<Record<string, unknown>>;
    readonly scripts?: Readonly<Record<string, string>>;
    readonly peerDependenciesMeta?: Readonly<Record<
        string,
        { readonly optional?: boolean }
    >>;
}

describe('package manifest', () => {
    it('publishes only executable CommonJS artifacts and supported subpaths', () => {
        const manifest = readManifest();

        expect(manifest.private).not.toBe(true);
        expect(manifest.type).toBe('commonjs');
        expect(manifest.main).toBe('./dist/index.js');
        expect(manifest.types).toBe('./dist/index.d.ts');
        expect(manifest.description).toContain('ORM for TypeScript');
        expect(manifest.author).toBe('zsumz <shawn@zsumz.com>');
        expect(manifest.license).toBe('MIT');
        expect(manifest.repository?.url).toContain('entitykit.git');
        expect(manifest.homepage).toContain('entitykit-poc/entitykit');
        expect(manifest.bugs?.url).toContain('/issues');
        expect(manifest.keywords).toEqual(expect.arrayContaining([
            'orm', 'typescript', 'sqlite', 'postgres', 'mysql',
        ]));
        expect(manifest.files).toEqual(['dist', 'README.md', 'LICENSE']);
        expect(manifest.bin).toEqual({ entitykit: 'dist/cli/index.js' });
        expect(manifest.publishConfig).toEqual({
            access: 'public',
            registry: 'https://registry.npmjs.org/',
            tag: 'alpha',
        });
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
            'check:publish-alpha': 'node scripts/check-alpha-publish.js',
            prepack: 'npm run build',
            prepublishOnly: 'node scripts/guard-alpha-publish.js',
            'release:alpha': 'npm publish --tag alpha',
        });
        expect(manifest.peerDependenciesMeta).toEqual({
            mysql2: { optional: true },
            pg: { optional: true },
        });
    });

    it('stamps applied migrations with the published package version', () => {
        const manifest = readManifest();

        // Every applied migration row records entityKitMigrationVersion, so a
        // release that bumps only package.json would stamp history with a
        // version that was never published.
        expect(entityKitMigrationVersion).toBe(manifest.version);
    });
});

function readManifest(): PackageManifest {
    return JSON.parse(fs.readFileSync(
        path.join(process.cwd(), 'package.json'),
        'utf8',
    )) as PackageManifest;
}

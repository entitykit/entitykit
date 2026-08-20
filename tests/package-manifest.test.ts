import fs from 'node:fs';
import path from 'node:path';
import { entityKitMigrationVersion } from '../packages/core/src/migrations/migration-metadata';

interface PackageManifest {
    readonly name?: string;
    readonly version?: string;
    readonly description?: string;
    readonly author?: string;
    readonly license?: string;
    readonly repository?: Readonly<Record<string, string>>;
    readonly homepage?: string;
    readonly bugs?: Readonly<Record<string, string>>;
    readonly keywords?: readonly string[];
    readonly private?: boolean;
    readonly workspaces?: readonly string[];
    readonly type?: string;
    readonly main?: string;
    readonly types?: string;
    readonly files?: readonly string[];
    readonly bin?: Readonly<Record<string, string>>;
    readonly publishConfig?: Readonly<Record<string, string>>;
    readonly exports?: Readonly<Record<string, unknown>>;
    readonly scripts?: Readonly<Record<string, string>>;
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly peerDependencies?: Readonly<Record<string, string>>;
}

const packageNames = ['core', 'sqlite', 'postgres', 'mysql', 'cli', 'testing'] as const;

/** Export subpaths each published package promises, keyed by directory name. */
const publishedExports: Readonly<Record<string, readonly string[]>> = {
    core: ['.', './adapter', './experimental', './migrations', './package.json', './tooling'],
    sqlite: ['.'],
    postgres: ['.'],
    mysql: ['.'],
    cli: ['.'],
    testing: ['.'],
};

function readManifest(...segments: string[]): PackageManifest {
    return JSON.parse(fs.readFileSync(
        path.join(process.cwd(), ...segments),
        'utf8',
    )) as PackageManifest;
}

describe('package manifest', () => {
    it('keeps the repository root private and lists the workspaces it owns', () => {
        const manifest = readManifest('package.json');

        // Nothing publishes from the root any more: each package ships itself.
        expect(manifest.private).toBe(true);
        expect(manifest.workspaces).toEqual(['packages/*']);
        expect(manifest.main).toBeUndefined();
        expect(manifest.exports).toBeUndefined();
        expect(manifest.bin).toBeUndefined();
        expect(manifest.scripts).toMatchObject({
            build: 'node scripts/build-package.js',
            'check:package': 'node scripts/check-package.js',
            'check:publish-alpha': 'node scripts/check-alpha-publish.js',
            typecheck: 'tsc -p tsconfig.json --noEmit',
            prepack: 'npm run build',
            prepublishOnly: 'node scripts/guard-alpha-publish.js',
            'release:alpha': 'npm publish --tag alpha',
            verify: 'npm run lint && npm run typecheck && npm test',
        });
    });

    it.each(packageNames)(
        'publishes %s as executable CommonJS with pinned files and subpaths',
        name => {
            const manifest = readManifest('packages', name, 'package.json');

            expect(manifest.name).toBe(name === 'core' ? '@entitykit/core' : `@entitykit/${name}`);
            expect(manifest.private).not.toBe(true);
            expect(manifest.type).toBe('commonjs');
            expect(manifest.main).toBe(name === 'cli' ? './dist/api.js' : './dist/index.js');
            expect(manifest.types).toBe(name === 'cli' ? './dist/api.d.ts' : './dist/index.d.ts');
            expect(manifest.author).toBe('zsumz <shawn@zsumz.com>');
            expect(manifest.license).toBe('MIT');
            expect(manifest.repository?.url).toContain('entitykit.git');
            expect(manifest.repository?.directory).toBe(`packages/${name}`);
            expect(manifest.homepage).toContain('entitykit-poc/entitykit');
            expect(manifest.bugs?.url).toContain('/issues');
            expect(manifest.keywords).toEqual(expect.arrayContaining(['orm', 'typescript']));
            expect(manifest.files).toEqual(['dist', 'README.md', 'LICENSE']);
            expect(Object.keys(manifest.exports ?? {}).sort())
                .toEqual([...publishedExports[name]]);
            expect(manifest.publishConfig).toEqual({
                access: 'public',
                registry: 'https://registry.npmjs.org/',
                tag: 'alpha',
            });
        },
    );

    it.each(packageNames)('ships every file %s pins in its manifest', name => {
        for (const file of ['README.md', 'LICENSE']) {
            expect(`${name}/${file}:${String(fs.existsSync(
                path.join(process.cwd(), 'packages', name, file),
            ))}`).toBe(`${name}/${file}:true`);
        }
    });

    it('installs the CLI executable under the product name', () => {
        const manifest = readManifest('packages', 'cli', 'package.json');

        expect(manifest.bin).toEqual({ entitykit: './dist/index.js' });
        expect(manifest.dependencies?.['@entitykit/core']).toBe(manifest.version);
    });

    it.each(['sqlite', 'postgres', 'mysql', 'testing'])(
        'has %s depend on core as a peer, so one core is installed',
        name => {
            const manifest = readManifest('packages', name, 'package.json');

            expect(manifest.peerDependencies?.['@entitykit/core']).toBe(manifest.version);
        },
    );

    it.each([['postgres', 'pg'], ['mysql', 'mysql2']])(
        'keeps the %s driver a peer dependency rather than a bundled one',
        (name, driver) => {
            const manifest = readManifest('packages', name, 'package.json');

            expect(Object.keys(manifest.peerDependencies ?? {}).sort())
                .toEqual(['@entitykit/core', driver]);
            expect(manifest.dependencies).toBeUndefined();
        },
    );

    it('stamps applied migrations with one version shared by every package', () => {
        const versions = packageNames.map(name =>
            readManifest('packages', name, 'package.json').version);

        // Every applied migration row records entityKitMigrationVersion, so a
        // release that bumps only a manifest would stamp history with a version
        // that was never published — and a package that lags behind the others
        // would stamp a version its own siblings never shipped.
        expect(new Set(versions).size).toBe(1);
        expect(entityKitMigrationVersion).toBe(versions[0]);
    });
});

import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { createManagedSuiteTempDirectory } from './support/managed-temp-directory';

const guard = path.join(process.cwd(), 'scripts', 'guard-alpha-publish.js');
let directory: string;

function writeManifest(version = '1.0.0', tag = 'latest'): void {
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({
        name: '@entitykit/stable-guard-probe', version, license: 'MIT', files: ['package.json'],
        publishConfig: { tag, access: 'public' },
        scripts: { prepublishOnly: `node "${guard}"` },
    }));
}

function environment(dryRun: boolean, marker = 'accept', tag = 'latest'): NodeJS.ProcessEnv {
    const env = { ...process.env };
    delete env.ENTITYKIT_ALPHA_DRY_RUN;
    delete env.ENTITYKIT_RELEASE_DRY_RUN;
    delete env.npm_config_dry_run;
    delete env.npm_config_tag;
    if (dryRun) env.npm_config_dry_run = 'true';
    env.ENTITYKIT_RELEASE_DRY_RUN = marker;
    env.npm_config_tag = tag;
    return env;
}

function run(dryRun = true, marker = 'accept', tag = 'latest'): ReturnType<typeof spawnSync> {
    return spawnSync(process.execPath, [guard], {
        cwd: directory, encoding: 'utf8', env: environment(dryRun, marker, tag),
    });
}

describe('prospective stable publication guard', () => {
    beforeAll(() => {
        directory = createManagedSuiteTempDirectory('entitykit-stable-guard-');
    });

    beforeEach(() => {
        writeManifest();
    });

    it('permits a marked stable latest dry run', () => {
        expect(run().status).toBe(0);
    });

    it.each([
        [false, 'accept', 'latest'],
        [true, '', 'latest'],
        [true, 'accept', 'alpha'],
        [true, 'accept', 'stable-candidate'],
    ])('refuses unsupported invocation %s/%s/%s', (dryRun, marker, tag) => {
        const result = run(dryRun, marker, tag);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('Refusing stable publication');
    });

    it('refuses legacy alpha acceptance markers for stable publication', () => {
        const env = environment(true, '');
        env.ENTITYKIT_ALPHA_DRY_RUN = 'accept';
        const result = spawnSync(process.execPath, [guard], {
            cwd: directory, encoding: 'utf8', env,
        });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('working-copy publication is disabled');
    });

    it.each(['alpha', 'stable-candidate'])('refuses a stable manifest pinned to %s', tag => {
        writeManifest('1.0.0', tag);
        expect(run().status).toBe(1);
    });

    it('rejects unsupported prerelease channels', () => {
        writeManifest('1.0.0-beta.1');
        const result = run();
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('Unsupported release version');
    });

    it('hands the real npm a synthetic stable package without publishing it', async () => {
        const npmCli = process.env.npm_execpath;
        expect(npmCli).toBeDefined();
        const methods: string[] = [];
        const registry = createServer((request, response) => {
            methods.push(request.method ?? '');
            response.writeHead(404, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ error: 'not found' }));
        });
        registry.listen(0, '127.0.0.1');
        await once(registry, 'listening');
        const { port } = registry.address() as AddressInfo;
        try {
            const child = spawn(process.execPath, [
                npmCli ?? '', 'publish', '--dry-run', '--tag', 'latest', '--loglevel=notice',
            ], {
                cwd: directory, timeout: 20_000,
                env: {
                    ...environment(true),
                    npm_config_userconfig: path.join(directory, '.npmrc'),
                    npm_config_cache: path.join(directory, 'npm-cache'),
                    npm_config_registry: `http://127.0.0.1:${String(port)}`,
                    npm_config_fetch_retries: '0',
                },
            });
            let output = '';
            child.stdout.on('data', chunk => {
                output += String(chunk); 
            });
            child.stderr.on('data', chunk => {
                output += String(chunk); 
            });
            const status = await new Promise<number | null>((resolve, reject) => {
                child.once('error', reject);
                child.once('close', resolve);
            });
            expect(`exit ${String(status)}\n${output}`).toMatch(/^exit 0\n/u);
            expect(output).toContain('with tag latest and public access (dry-run)');
            expect(output).toContain('@entitykit/stable-guard-probe@1.0.0');
            expect(methods.every(method => method === 'GET')).toBe(true);
        } finally {
            registry.closeAllConnections();
            await new Promise<void>(resolve => {
                registry.close(() => {
                    resolve(); 
                }); 
            });
        }
    }, 30_000);
});

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const packages = ['core', 'sqlite', 'postgres', 'mysql', 'cli', 'testing', 'nestjs'];

describe('package-family builds', () => {
    it('reuses unchanged outputs and removes obsolete files in an explicit clean build', () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'entitykit-build-'));
        try {
            fs.mkdirSync(path.join(project, 'scripts'));
            fs.copyFileSync(path.join(process.cwd(), 'scripts/build-package.js'),
                path.join(project, 'scripts/build-package.js'));
            for (const name of packages) {
                const directory = path.join(project, 'packages', name);
                fs.mkdirSync(path.join(directory, 'src'), { recursive: true });
                fs.writeFileSync(path.join(directory, 'src/index.ts'), 'export const value = 1;\n');
                fs.writeFileSync(path.join(directory, 'tsconfig.json'), JSON.stringify({
                    compilerOptions: {
                        composite: true, declaration: true, rootDir: 'src', outDir: 'dist',
                        module: 'commonjs', target: 'ES2022', types: [], skipLibCheck: true,
                    },
                    include: ['src/**/*.ts'],
                }));
            }
            const removedSource = path.join(project, 'packages/core/src/removed.ts');
            fs.writeFileSync(removedSource, 'export const obsolete = true;\n');
            const build = (...args: string[]): void => {
                const result = spawnSync(process.execPath, ['scripts/build-package.js', ...args], {
                    cwd: project, encoding: 'utf8',
                    env: { ...process.env, NODE_PATH: path.join(process.cwd(), 'node_modules') },
                });
                expect({ status: result.status, output: result.stdout + result.stderr })
                    .toEqual({ status: 0, output: '' });
            };
            build();
            const artifacts = packages.flatMap(name => [
                path.join(project, 'packages', name, 'dist/index.js'),
                path.join(project, 'packages', name, 'dist/index.d.ts'),
                path.join(project, 'packages', name, 'tsconfig.tsbuildinfo'),
            ]);
            // Older output timestamps make any rewrite observable on filesystems
            // whose timestamp resolution is coarser than a compiler invocation.
            const old = new Date('2020-01-01T00:00:00Z');
            for (const file of artifacts) fs.utimesSync(file, old, old);
            const before = artifacts.map(file => ({
                bytes: fs.readFileSync(file), modified: fs.statSync(file).mtimeMs,
            }));
            // Keep build info newer than the inputs, as it is after a real build.
            for (const name of packages) {
                const source = path.join(project, 'packages', name, 'src/index.ts');
                const config = path.join(project, 'packages', name, 'tsconfig.json');
                const older = new Date('2019-01-01T00:00:00Z');
                fs.utimesSync(source, older, older);
                fs.utimesSync(config, older, older);
            }
            fs.utimesSync(removedSource, new Date('2019-01-01T00:00:00Z'),
                new Date('2019-01-01T00:00:00Z'));
            build();
            expect(artifacts.map(file => ({
                bytes: fs.readFileSync(file), modified: fs.statSync(file).mtimeMs,
            }))).toEqual(before);

            // Retaining build info must not make a successful build skip
            // deleted runtime, declaration or executable outputs.
            const missing = [
                path.join(project, 'packages/sqlite/dist'),
                path.join(project, 'packages/postgres/dist/index.js'),
                path.join(project, 'packages/mysql/dist/index.d.ts'),
                path.join(project, 'packages/core/dist/removed.js'),
                path.join(project, 'packages/core/dist/removed.d.ts'),
                path.join(project, 'packages/cli/dist/index.js'),
            ];
            for (const file of missing) fs.rmSync(file, { recursive: true, force: true });
            build();
            for (const file of [...artifacts, ...missing]) expect(fs.existsSync(file)).toBe(true);

            fs.unlinkSync(removedSource);
            const obsoleteOutput = path.join(project, 'packages/core/dist/removed.js');
            expect(fs.existsSync(obsoleteOutput)).toBe(true);
            build('--clean');
            expect(fs.existsSync(obsoleteOutput)).toBe(false);
            expect(fs.existsSync(path.join(project, 'packages/core/dist/removed.d.ts'))).toBe(false);
            for (const file of artifacts) expect(fs.existsSync(file)).toBe(true);
            expect(fs.statSync(path.join(project, 'packages/cli/dist/index.js')).mode & 0o111)
                .toBe(0o111);
        } finally {
            fs.rmSync(project, { recursive: true, force: true });
        }
    }, 30_000);
});

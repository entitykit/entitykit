import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { runEntityKitCli } from '../packages/cli/src/api';
import { loadEntityKitConfig } from '../packages/cli/src/entity-kit-config';
import { createManagedTempDirectory } from './support/managed-temp-directory';

describe('entitykit init', () => {
    it('creates a minimal SQLite setup and package scripts by default', async () => {
        const cwd = createManagedTempDirectory('entitykit-init-');
        fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({
            name: 'app',
            private: true,
            scripts: { test: 'node --test' },
        }, null, 2));

        const result = await runEntityKitCli(['init'], { cwd });

        expect(result).toMatchObject({
            exitCode: 0,
            outcome: 'success',
            data: { provider: 'sqlite' },
        });
        expect(fs.readFileSync(path.join(cwd, 'entitykit.config.ts'), 'utf8'))
            .toContain('sqliteProviderServices');
        expect(fs.readFileSync(path.join(cwd, 'src/db/app-db-context.ts'), 'utf8'))
            .toContain('options.useSqlite');
        const manifest = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')) as {
            scripts: Record<string, string>;
        };
        expect(manifest.scripts).toEqual({
            test: 'node --test',
            'db:migrate': 'entitykit db migrate',
            'db:status': 'entitykit db status --check',
        });

        const config = await loadEntityKitConfig({ cwd });
        expect(config.provider.name).toBe('sqlite');
        expect(config.connection).toBe(path.join(cwd, 'entitykit.db'));
        const context = config.context.create();
        await context.dispose();
    });

    it('generates explicit provider configuration', async () => {
        const cwd = createManagedTempDirectory('entitykit-init-postgres-');

        const result = await runEntityKitCli(['init', '--provider=postgres'], { cwd });

        expect(result).toMatchObject({ exitCode: 0, data: { provider: 'postgres' } });
        expect(fs.readFileSync(path.join(cwd, 'entitykit.config.ts'), 'utf8'))
            .toContain('provider: postgresProviderServices');
        expect(fs.readFileSync(path.join(cwd, 'src/db/app-db-context.ts'), 'utf8'))
            .toContain('options.usePostgres(requiredDatabaseUrl())');
        expect(result.stdout).toContain(
            'npm install @entitykit/core@alpha @entitykit/postgres@alpha pg',
        );
        expect(result.stdout).toContain('npm install -D @entitykit/cli@alpha');
    });

    it.each([
        { packageType: undefined, module: ts.ModuleKind.CommonJS, marker: '__dirname' },
        { packageType: 'module', module: ts.ModuleKind.ESNext, marker: 'import.meta.url' },
    ])('emits compilable $packageType module paths', async ({ packageType, module, marker }) => {
        const cwd = createManagedTempDirectory('entitykit-init-module-');
        fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({
            name: 'app',
            ...packageType ? { type: packageType } : {},
        }));

        const result = await runEntityKitCli(['init'], { cwd });
        const sources = [
            fs.readFileSync(path.join(cwd, 'entitykit.config.ts'), 'utf8'),
            fs.readFileSync(path.join(cwd, 'src/db/app-db-context.ts'), 'utf8'),
        ];

        expect(result.exitCode).toBe(0);
        expect(sources.join('\n')).toContain(marker);
        if (packageType === 'module') {
            expect(sources[0]).toContain('./src/db/app-db-context.js');
        }
        const diagnostics = sources.flatMap(source => ts.transpileModule(source, {
            compilerOptions: { module, target: ts.ScriptTarget.ES2022 },
            reportDiagnostics: true,
        }).diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error);
        expect(diagnostics.map(diagnostic => diagnostic.code)).toEqual([]);
    });

    it('preflights collisions before changing any file', async () => {
        const cwd = createManagedTempDirectory('entitykit-init-collision-');
        const configPath = path.join(cwd, 'entitykit.config.ts');
        fs.writeFileSync(configPath, 'keep me');
        fs.writeFileSync(path.join(cwd, 'package.json'), '{"name":"app"}\n');

        const result = await runEntityKitCli(['init'], { cwd });

        expect(result).toMatchObject({ exitCode: 1, outcome: 'error' });
        expect(result.stderr).toContain('Refusing to overwrite existing file');
        expect(fs.readFileSync(configPath, 'utf8')).toBe('keep me');
        expect(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).toBe('{"name":"app"}\n');
        expect(fs.existsSync(path.join(cwd, 'src/db/app-db-context.ts'))).toBe(false);
    });

    it('allows an intentional regeneration with --force', async () => {
        const cwd = createManagedTempDirectory('entitykit-init-force-');
        fs.writeFileSync(path.join(cwd, 'entitykit.config.ts'), 'replace me');
        fs.mkdirSync(path.join(cwd, 'src/db'), { recursive: true });
        fs.writeFileSync(path.join(cwd, 'src/db/app-db-context.ts'), 'replace me');

        const result = await runEntityKitCli(['init', '--force', '--provider', 'mysql'], { cwd });

        expect(result.exitCode).toBe(0);
        expect(fs.readFileSync(path.join(cwd, 'entitykit.config.ts'), 'utf8'))
            .toContain('mySqlProviderServices');
    });
});

import fs from 'node:fs';
import path from 'node:path';
import { parseCommandArguments } from '../cli-command-parser';
import type { ParsedGlobalOptions } from '../cli-option-reader';
import type { EntityKitCliOptions, EntityKitCliResult } from '../cli-result';
import { ok } from '../cli-result';
import { resolveCliCwd } from '../cli-runtime';
import { renderCommandHelp } from '../cli-help';
import { writeFilesAtomically, type AtomicFileWrite } from '../../tooling/atomic-file-writer';
import { CliUsageError } from '../cli-usage-error';
import {
    type BuiltInProvider,
    projectModuleStyle,
    renderInitConfig,
    renderInitContext,
} from './init-templates';

/** Create a deterministic, minimal EntityKit project setup. */
export function runInitCommand(
    args: readonly string[],
    global: ParsedGlobalOptions,
    options: EntityKitCliOptions,
): EntityKitCliResult {
    const parsed = parseCommandArguments(args, 'init');
    const provider = parseProvider(parsed.value('--provider'));
    const root = resolveCliCwd(global, options);
    const moduleStyle = projectModuleStyle(root);
    const force = parsed.has('--force');
    assertNoPositionals(parsed.positionals);

    const configPath = path.join(root, 'entitykit.config.ts');
    const contextPath = path.join(root, 'src', 'db', 'app-db-context.ts');
    const packageWrite = updatePackageJson(root);
    const writes: AtomicFileWrite[] = [
        { path: configPath, contents: renderInitConfig(provider, moduleStyle), replace: force },
        { path: contextPath, contents: renderInitContext(provider, moduleStyle), replace: force },
        ...packageWrite ? [packageWrite] : [],
    ];
    writeFilesAtomically(writes);

    const relativeFiles = writes.map(write => path.relative(root, write.path));
    return ok([
        `Initialized EntityKit with ${provider}.`,
        ...relativeFiles.map(file => `  ${file}`),
        '',
        installGuidance(root, provider),
        'Next: entitykit migration add InitialCreate',
        'Then: entitykit db migrate',
    ].join('\n'), {
        provider,
        files: relativeFiles,
    });
}

function parseProvider(value: string | undefined): BuiltInProvider {
    const provider = value ?? 'sqlite';
    if (provider === 'sqlite' || provider === 'postgres' || provider === 'mysql') {
        return provider;
    }
    throw new CliUsageError('--provider must be sqlite, postgres, or mysql.');
}

function assertNoPositionals(positionals: readonly string[]): void {
    if (positionals.length > 0) {
        throw new CliUsageError(`init does not accept positional arguments.\n\n${renderCommandHelp('init')}`);
    }
}

function updatePackageJson(root: string): AtomicFileWrite | undefined {
    const packagePath = path.join(root, 'package.json');
    if (!fs.existsSync(packagePath)) {
        return undefined;
    }
    const source = fs.readFileSync(packagePath, 'utf8');
    const manifest = JSON.parse(source) as { scripts?: Record<string, string> };
    manifest.scripts = {
        ...manifest.scripts,
        'db:migrate': manifest.scripts?.['db:migrate'] ?? 'entitykit db migrate',
        'db:status': manifest.scripts?.['db:status'] ?? 'entitykit db status --check',
    };
    const indentation = /^([ \t]+)"/m.exec(source)?.[1] ?? '  ';
    return {
        path: packagePath,
        contents: `${JSON.stringify(manifest, null, indentation)}\n`,
        replace: true,
    };
}

function installGuidance(root: string, provider: BuiltInProvider): string {
    const manager = fs.existsSync(path.join(root, 'pnpm-lock.yaml'))
        ? 'pnpm add'
        : fs.existsSync(path.join(root, 'yarn.lock'))
            ? 'yarn add'
            : 'npm install';
    const driver = provider === 'postgres' ? ' pg' : provider === 'mysql' ? ' mysql2' : '';
    return `Install if needed: ${manager} entitykit${driver}`;
}

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadTypeScriptModule } from '../tooling/typescript-module-loader';
import { createEntityKitModuleAliases } from './entity-kit-module-aliases';

const loadModule = createRequire(__filename);
const sourceRuntime = __filename.endsWith('.ts');
const configFileNames = [
    'entitykit.config.ts', 'entitykit.config.mts', 'entitykit.config.cts',
    'entitykit.config.js', 'entitykit.config.mjs', 'entitykit.config.cjs',
] as const;

/** Find the nearest EntityKit config at or above a discovery directory. */
export function findEntityKitConfig(discoveryRoot: string): string | undefined {
    let directory = discoveryRoot;
    for (;;) {
        const found = configFileNames
            .map(fileName => path.join(directory, fileName))
            .find(candidate => fs.existsSync(candidate));
        if (found) {
            return found;
        }
        const parent = path.dirname(directory);
        if (parent === directory) {
            return undefined;
        }
        directory = parent;
    }
}

/** Load and normalize CommonJS, ESM, or TypeScript configuration. */
export async function loadEntityKitConfigExport(configPath: string): Promise<unknown> {
    const extension = path.extname(configPath).toLowerCase();
    let loaded: unknown;
    if (extension === '.mjs' || extension === '.js' && isEsmJavaScript(configPath)) {
        loaded = await import(pathToFileURL(configPath).href);
    } else if (extension === '.ts' || extension === '.mts' || extension === '.cts') {
        loaded = loadTypeScriptModule(
            configPath,
            createEntityKitModuleAliases(loadModule, sourceRuntime),
        );
    } else {
        loaded = loadModule(configPath) as unknown;
    }
    return defaultExport(loaded);
}

function isEsmJavaScript(filePath: string): boolean {
    let directory = path.dirname(filePath);
    for (;;) {
        const packagePath = path.join(directory, 'package.json');
        if (fs.existsSync(packagePath)) {
            const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as {
                readonly type?: unknown;
            };
            return manifest.type === 'module';
        }
        const parent = path.dirname(directory);
        if (parent === directory) {
            return false;
        }
        directory = parent;
    }
}

function defaultExport(value: unknown): unknown {
    if (
        value !== null &&
        typeof value === 'object' &&
        'default' in value &&
        value.default !== undefined
    ) {
        return value.default;
    }
    return value;
}

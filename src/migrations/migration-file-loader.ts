import { createRequire } from 'node:module';
import path from 'path';
import { pathToFileURL } from 'node:url';
import { loadTypeScriptModule } from '../tooling/typescript-module-loader';
import type { Migration } from './migration';

const loadModule = createRequire(__filename);

/** Perform the load migration file operation. */ export async function loadMigrationFile(
    filePath: string,
): Promise<Migration> {
    const extension = path.extname(filePath).toLowerCase();
    const exports: unknown = extension === '.mjs'
        ? await import(pathToFileURL(filePath).href)
        : extension === '.ts'
            ? loadTypeScriptModule(filePath, {
                entitykit: () => loadModule('../index') as unknown,
                'entitykit/migrations': () => loadModule('./api') as unknown,
                // The config definition API lives in core; core never reaches
                // into the CLI, which is its own package after the split.
                'entitykit/cli': () => loadModule('../entity-kit-config') as unknown,
            })
            : loadModule(filePath) as unknown;

    const migration = instantiateMigration(exports);
    if (!migration) {
        throw new Error(
            `Migration file '${filePath}' must export a Migration class or instance.`,
        );
    }

    return migration;
}

function instantiateMigration(exports: unknown): Migration | undefined {
    const candidates = collectExportCandidates(exports);
    for (const candidate of candidates) {
        if (isMigrationInstance(candidate)) {
            return candidate;
        }

        if (typeof candidate === 'function') {
            try {
                const instance = new (candidate as new () => unknown)();
                if (isMigrationInstance(instance)) {
                    return instance;
                }
            } catch {
                // Try the next export.
            }
        }
    }

    return undefined;
}

function collectExportCandidates(exports: unknown): unknown[] {
    const candidates = [exports];
    const record = exports as Record<string, unknown> | undefined;
    if (record && typeof record === 'object') {
        if ('default' in record) {
            candidates.push(record.default);
        }
        candidates.push(...Object.values(record));
    }
    return candidates;
}

function isMigrationInstance(value: unknown): value is Migration {
    const migration = value as Migration | undefined;
    return Boolean(
        migration &&
    typeof migration.id === 'string' &&
    typeof migration.name === 'string' &&
    typeof migration.up === 'function' &&
    typeof migration.down === 'function',
    );
}

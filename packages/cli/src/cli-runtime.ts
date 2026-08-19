import path from 'node:path';
import type { ParsedGlobalOptions } from './cli-option-reader';
import type { EntityKitCliOptions } from './cli-result';
import { loadEntityKitConfig, type ResolvedEntityKitConfig } from './entity-kit-config';

/** Resolve the command working directory without changing process state. */
export function resolveCliCwd(
    global: ParsedGlobalOptions,
    options: EntityKitCliOptions,
): string {
    const base = path.resolve(options.cwd ?? process.cwd());
    return global.cwd ? path.resolve(base, global.cwd) : base;
}

/** Load config using the invocation's explicit discovery root. */
export async function loadCliConfig(
    global: ParsedGlobalOptions,
    options: EntityKitCliOptions,
): Promise<ResolvedEntityKitConfig> {
    return await loadEntityKitConfig({
        cwd: resolveCliCwd(global, options),
        configPath: global.configPath,
    });
}

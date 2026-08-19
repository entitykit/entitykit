import { createRequire } from 'node:module';
import type { DatabaseProviderServices } from '../storage/database-provider-services';

const loadModule = createRequire(__filename);

/** Load one built-in provider without adding it to core's static import graph. */
export function loadBuiltInProviderServices<TConfig extends object>(
    moduleId: string,
    exportName: string,
    unavailableMessage: string,
): DatabaseProviderServices<TConfig> {
    try {
        const providerModule = loadModule(moduleId) as Record<string, unknown>;
        return providerModule[exportName] as DatabaseProviderServices<TConfig>;
    } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code === 'MODULE_NOT_FOUND') {
            throw new Error(unavailableMessage, { cause: error });
        }
        throw error;
    }
}

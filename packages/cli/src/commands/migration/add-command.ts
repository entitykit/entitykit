import { addMigration } from '@entitykit/core/migrations';
import path from 'node:path';
import { contextMigrations } from '@entitykit/core/migrations';
import { parseCommandArguments } from '../../cli-command-parser';
import { renderCommandHelp } from '../../cli-help';
import type { ParsedGlobalOptions } from '../../cli-option-reader';
import { parseRenameHintValues } from '../../cli-rename-hints';
import { CliUsageError } from '../../cli-usage-error';
import { loadCliConfig } from '../../cli-runtime';
import { ok, type EntityKitCliOptions, type EntityKitCliResult } from '../../cli-result';
import { renderAddResult } from '../../output/migration-results';
import { renderMigrationStub } from '../../output/migration-stub';

/** Create a source-controlled migration and model snapshot. */
export async function runMigrationAddCommand(
    args: readonly string[],
    global: ParsedGlobalOptions,
    options: EntityKitCliOptions,
): Promise<EntityKitCliResult> {
    const parsed = parseCommandArguments(args, 'migration add');
    const [name, ...unexpected] = parsed.positionals;
    if (!name) {
        throw new CliUsageError(`migration add requires a name.\n\n${renderCommandHelp('migration add')}`);
    }
    if (unexpected.length > 0) {
        throw new CliUsageError('migration add accepts one name. Quote names that contain spaces.');
    }
    if (parsed.has('--stdout')) {
        return ok(renderMigrationStub(name), { name });
    }

    const config = await loadCliConfig(global, options);
    const context = config.context.create();
    try {
        const result = addMigration(contextMigrations(context), {
            name,
            migrationsDir: config.migrationsDir,
            snapshotPath: config.snapshot,
            now: options.now ?? config.now(),
            allowEmpty: parsed.has('--empty'),
            allowDataLoss: true,
            renameHints: parseRenameHintValues(
                parsed.values('--rename-table'),
                parsed.values('--rename-column'),
            ),
        });
        return ok(
            renderAddResult(result, config.projectRoot),
            {
                id: result.id,
                migrationPath: relativePath(config.projectRoot, result.migrationPath),
                snapshotPath: relativePath(config.projectRoot, result.snapshotPath),
                operations: result.operations,
            },
            result.warnings.map(message => ({ code: 'MIGRATION_DATA_LOSS', message })),
        );
    } finally {
        await context.dispose();
    }
}

function relativePath(root: string, filePath: string): string {
    return path.relative(root, filePath);
}

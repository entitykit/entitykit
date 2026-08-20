import path from 'node:path';
import { listMigrations } from '@entitykit/core/migrations';
import { MigrationSqlGenerator } from '@entitykit/core/migrations';
import { writeFilesAtomically } from '@entitykit/core/tooling';
import { parseCommandArguments } from '../../cli-command-parser';
import type { ParsedGlobalOptions } from '../../cli-option-reader';
import { CliUsageError } from '../../cli-usage-error';
import { loadCliConfig } from '../../cli-runtime';
import { ok, type EntityKitCliOptions, type EntityKitCliResult } from '../../cli-result';

/** Generate deterministic offline SQL between explicit migration boundaries. */
export async function runMigrationScriptCommand(
    args: readonly string[],
    global: ParsedGlobalOptions,
    options: EntityKitCliOptions,
): Promise<EntityKitCliResult> {
    const parsed = parseCommandArguments(args, 'migration script');
    if (parsed.positionals.length > 0) {
        throw new CliUsageError('migration script uses --from and --to; it does not accept positional ranges.');
    }
    const config = await loadCliConfig(global, options);
    const migrations = await listMigrations(config.migrationsDir);
    const from = normalizeBoundary(parsed.value('--from'));
    const to = normalizeBoundary(parsed.value('--to'));
    const script = new MigrationSqlGenerator(
        config.provider.migrationDialect,
        config.provider.createMigrationBuilder,
    ).generateScript(
        migrations.map(item => item.migration),
        { from, to, idempotent: parsed.has('--idempotent') },
    );
    const output = parsed.value('--output');
    if (!output) {
        return ok(script, { from: from ?? '0', to: to ?? 'Latest', script });
    }
    const outputPath = path.resolve(config.projectRoot, output);
    writeFilesAtomically([{ path: outputPath, contents: script }]);
    const relativeOutput = path.relative(config.projectRoot, outputPath);
    return ok(`Wrote migration script to ${relativeOutput}.`, {
        from: from ?? '0',
        to: to ?? 'Latest',
        outputPath: relativeOutput,
    });
}

function normalizeBoundary(value: string | undefined): string | undefined {
    return value?.toLowerCase() === 'latest' ? 'Latest' : value;
}

import path from 'node:path';
import { generateDbPullCodeWithDiagnostics } from '../../../introspection/db-pull-code-generator';
import {
    awaitWithOperationCancellation,
    throwIfOperationAborted,
} from '../../../storage/operation-cancellation';
import { withOperationSignal } from '../../../storage/with-operation-signal';
import { safeGeneratedPath, writeFilesAtomically } from '../../../tooling/atomic-file-writer';
import { parseCommandArguments } from '../../cli-command-parser';
import type { ParsedGlobalOptions } from '../../cli-option-reader';
import { CliUsageError } from '../../cli-usage-error';
import { resolveProjectPath } from '../../cli-project-path';
import { loadCliConfig } from '../../cli-runtime';
import { ok, type EntityKitCliOptions, type EntityKitCliResult } from '../../cli-result';
import { resolveEntityKitConnection } from '../../entity-kit-connection-config';
import { renderDbPullWriteResult, renderGeneratedFiles } from '../../output/db-pull-output';
import { createDatabaseConnection } from '../provider-connection';

/** Introspect a live schema and emit collision-safe starter model files. */
export async function runDbPullCommand(
    args: readonly string[],
    global: ParsedGlobalOptions,
    options: EntityKitCliOptions,
): Promise<EntityKitCliResult> {
    const parsed = parseCommandArguments(args, 'db pull');
    if (parsed.positionals.length > 0) {
        throw new CliUsageError('db pull does not accept positional arguments.');
    }
    const config = await loadCliConfig(global, options);
    const connectionConfig = await resolveEntityKitConnection(config);
    if (!connectionConfig) {
        throw new Error('db pull requires connection in entitykit config or DATABASE_URL.');
    }
    if (!config.provider.createSchemaIntrospector) {
        throw new Error(`db pull is not available for provider '${config.provider.name}'.`);
    }

    const connection = createDatabaseConnection(config.provider, connectionConfig);
    try {
        throwIfOperationAborted(options.signal);
        const schemas = parsed.values('--schema');
        const introspector = config.provider.createSchemaIntrospector(
            withOperationSignal(connection, options.signal),
        );
        const snapshot = await awaitWithOperationCancellation(
            introspector.introspect(schemas.length > 0 ? { schemas } : {}),
            options.signal,
        );
        throwIfOperationAborted(options.signal);
        const generated = generateDbPullCodeWithDiagnostics(snapshot, {
            contextName: parsed.value('--context') ?? 'AppDbContext',
            providerName: config.provider.name,
        });
        const data = {
            files: generated.files.map(file => file.path),
            diagnostics: generated.diagnostics,
        };
        if (parsed.has('--stdout')) {
            return ok(renderGeneratedFiles(generated.files, generated.diagnostics), data);
        }

        const output = parsed.value('--output');
        const outputDir = output
            ? resolveProjectPath(config.projectRoot, output)
            : path.join(config.projectRoot, 'src', 'db', 'pulled');
        writeFilesAtomically(generated.files.map(file => ({
            path: safeGeneratedPath(outputDir, file.path),
            contents: file.contents,
            replace: parsed.has('--force'),
        })));
        return ok(renderDbPullWriteResult(
            generated.files.length,
            path.relative(config.projectRoot, outputDir),
            generated.diagnostics,
        ), { ...data, outputDir: path.relative(config.projectRoot, outputDir) });
    } finally {
        await connection.dispose?.();
    }
}

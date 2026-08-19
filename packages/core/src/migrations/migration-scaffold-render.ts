/**
 * Rendering the migration `.ts` source from a diff.
 *
 * Emits the class skeleton, then an `up()` body — destructive-change warnings
 * followed by one builder call per operation — and a `down()` body that inverts
 * each operation in reverse order. Down for a create is a drop and vice versa;
 * down for an alter swaps the old/new column facets. Operations retain the
 * schema metadata needed to render their inverse; intentionally irreversible
 * raw SQL remains the only case represented by an explanatory comment.
 */
import type { ModelSnapshot } from '../model/model-snapshot-types';
import type { ModelDiffOperation } from './model-differ';
import { renderOperations } from './migration-operation-renderer';
import { stringifyModelSnapshot } from './model-snapshot-serialization';

export function renderMigrationSource(options: {
    readonly id: string;
    readonly className: string;
    readonly previousSnapshot: ModelSnapshot;
    readonly targetSnapshot: ModelSnapshot;
    readonly operations: readonly ModelDiffOperation[];
    readonly warnings: readonly string[];
}): string {
    return [
        'import { Migration, MigrationBuilder, type ModelSnapshot } from "entitykit/migrations";',
        '',
        `export default class ${options.className} extends Migration {`,
        `  readonly id = ${JSON.stringify(options.id)};`,
        `  readonly name = ${JSON.stringify(options.className)};`,
        `  override readonly previousSnapshot = ${stringifyModelSnapshot(options.previousSnapshot)} satisfies ModelSnapshot;`,
        `  override readonly targetSnapshot = ${stringifyModelSnapshot(options.targetSnapshot)} satisfies ModelSnapshot;`,
        '',
        '  override up(builder: MigrationBuilder): void {',
        ...renderWarningComments(options.warnings),
        ...renderOperations(options.operations, 'up'),
        '  }',
        '',
        '  override down(builder: MigrationBuilder): void {',
        ...renderOperations([...options.operations].reverse(), 'down'),
        '  }',
        '}',
        '',
    ].join('\n');
}

function renderWarningComments(warnings: readonly string[]): string[] {
    if (warnings.length === 0) {
        return [];
    }

    return [
        '    // WARNING: This operation may cause data loss.',
        '    // Review before applying; use rename helpers or builder.sql(...) backfills when preserving data.',
        ...warnings.map(warning => `    // - ${warning}`),
    ];
}

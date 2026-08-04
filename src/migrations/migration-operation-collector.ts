import { MigrationError } from '../errors/migration-errors';
import { assertSynchronousCallbackResult } from '../synchronous-callback';
import type { Migration } from './migration';
import type {
    MigrationBuilder,
    MigrationBuilderFactory,
} from './migration-builder-contract';

export function collectMigrationOperation(
    migration: Migration,
    direction: 'up' | 'down',
    createBuilder: MigrationBuilderFactory,
): MigrationBuilder {
    const builder = createBuilder();
    // The public void contract hides values that JavaScript still returns.
    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
    const result: unknown = migration[direction](builder);
    assertSynchronousCallbackResult(
        result,
        `Migration '${migration.id}' ${direction}()`,
        message => new MigrationError(message, {
            details: {
                migrationId: migration.id,
                migrationName: migration.name,
                direction,
                contractViolation: 'asyncMigrationDefinition',
            },
        }),
    );
    return builder;
}

import type { MigrationBuilder } from './migration-builder-contract';
import type { ModelSnapshot } from '../model/model-snapshot-types';

/**
 * Base class for reviewable schema migrations.
 *
 * Implement `up` to apply a migration and optionally `down` to revert it.
 */
export abstract class Migration {
    /**
   * Stable timestamp-style identifier used for ordering and history rows.
   */
    public abstract readonly id: string;

    /**
   * Human-readable migration name.
   */
    public abstract readonly name: string;

    /** The previous snapshot. */ public readonly previousSnapshot?: ModelSnapshot;
    /** The target snapshot. */ public readonly targetSnapshot?: ModelSnapshot;

    /**
   * Add SQL operations required to apply the migration.
   */
    public abstract up(builder: MigrationBuilder): void;

    /**
   * Add SQL operations required to revert the migration.
   */
    public down(builder: MigrationBuilder): void {
        void builder;
        // Migrations may override this when rollback SQL is available.
    }
}

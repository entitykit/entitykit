import { MigrationError } from '../../errors/migration-errors';
import type { Migration } from '../migration';
import type { MigrationHistoryRow } from '../migration-history';
import type { MigrationRangeItem } from '../migration-range';
import { selectMigrationRange } from '../migration-range';
import {
    destructiveWarningsForMigration,
    validateAppliedChecksums,
} from './history-validation';

/** Pure, validated migration plan shared by previews and execution. */
export interface MigrationUpdatePlan {
    /** Newest migration currently recorded by the database. */ readonly from: string;
    /** Requested target boundary. */ readonly target: string;
    /** Ordered forward or reverse migration steps. */ readonly steps: readonly MigrationRangeItem[];
    /** Destructive forward-operation warnings. */ readonly warnings: readonly string[];
}

/** Validate local/database history and select the exact update range. */
export function createMigrationUpdatePlan(
    migrations: readonly Migration[],
    applied: readonly MigrationHistoryRow[],
    checksum: (migration: Migration) => string,
    target?: string,
): MigrationUpdatePlan {
    const ordered = [...migrations].sort((left, right) => left.id.localeCompare(right.id));
    validateAppliedChecksums(ordered, applied, checksum);
    const from = applied.at(-1)?.id ?? '0';
    const appliedIds = new Set(applied.map(item => item.id));
    const skipped = ordered.filter(migration =>
        !appliedIds.has(migration.id) && migration.id < from);
    if (skipped.length > 0) {
        throw skippedMigrationError(skipped, from);
    }

    const resolvedTarget = target ?? 'Latest';
    const steps = selectMigrationRange(ordered, from, resolvedTarget);
    return {
        from,
        target: resolvedTarget,
        steps,
        warnings: steps.flatMap(step =>
            step.direction === 'up'
                ? destructiveWarningsForMigration(step.migration)
                : []),
    };
}

function skippedMigrationError(skipped: readonly Migration[], latestApplied: string): MigrationError {
    const plural = skipped.length > 1;
    return new MigrationError(
        `Migration${plural ? 's' : ''} ${skipped.map(migration => `'${migration.id}'`).join(', ')} ` +
        `${plural ? 'are' : 'is'} pending but ${plural ? 'sort' : 'sorts'} before the newest applied migration ` +
        `'${latestApplied}', so ${plural ? 'they' : 'it'} would be skipped. Renumber ` +
        `${plural ? 'them' : 'it'} after '${latestApplied}', or revert the database past ` +
        `${plural ? 'them' : 'it'} and reapply in order.`,
        { details: { migrationId: skipped[0].id } },
    );
}

import type { Migration } from './migration';

/** Public contract for migration range item. */ export interface MigrationRangeItem {
    /** The migration. */ readonly migration: Migration;
    /** The direction. */ readonly direction: 'up' | 'down';
}

/** Perform the select migration range operation. */ export function selectMigrationRange(
    migrations: readonly Migration[],
    from: string | undefined = '0',
    to: string | undefined = 'Latest',
): readonly MigrationRangeItem[] {
    const ordered = [...migrations].sort((left, right) =>
        left.id.localeCompare(right.id),
    );
    const fromIndex = resolveMigrationBoundary(ordered, from, 'from');
    const toIndex = resolveMigrationBoundary(ordered, to, 'to');

    if (fromIndex === toIndex) {
        return [];
    }

    if (fromIndex < toIndex) {
        return ordered
            .slice(fromIndex, toIndex)
            .map(migration => ({ migration, direction: 'up' as const }));
    }

    return ordered
        .slice(toIndex, fromIndex)
        .reverse()
        .map(migration => ({ migration, direction: 'down' as const }));
}

function resolveMigrationBoundary(
    migrations: readonly Migration[],
    boundary: string | undefined,
    label: 'from' | 'to',
): number {
    if (!boundary || boundary === '0') {
        return 0;
    }

    if (boundary === 'Latest') {
        return migrations.length;
    }

    const index = migrations.findIndex(
        migration =>
            migration.id === boundary ||
      migration.name === boundary ||
      migration.id.endsWith(`_${boundary}`),
    );
    if (index === -1) {
        throw new Error(`Unknown ${label} migration '${boundary}'.`);
    }

    return index + 1;
}

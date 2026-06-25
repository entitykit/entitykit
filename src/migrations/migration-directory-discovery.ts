import fs from 'fs';
import path from 'path';
import type {
    DiscoveredMigration,
    MigrationDiscoveryResult,
} from './migration-discovery-types';
import { loadMigrationFile } from './migration-file-loader';

const migrationFilePattern = /^\d{14}_.+\.(ts|js|cjs|mjs)$/;

/** Perform the discover migrations operation. */ export async function discoverMigrations(
    migrationsDir: string,
): Promise<MigrationDiscoveryResult> {
    if (!fs.existsSync(migrationsDir)) {
        return { migrations: [] };
    }

    const files = fs.readdirSync(migrationsDir)
        .filter(fileName => migrationFilePattern.test(fileName))
        .sort();

    const migrations = await Promise.all(files.map(async fileName => {
        const filePath = path.join(migrationsDir, fileName);
        return { migration: await loadMigrationFile(filePath), filePath };
    }));

    validateMigrations(migrations);
    return { migrations };
}

function validateMigrations(
    items: readonly DiscoveredMigration[],
): void {
    const ids: Map<string, string> = new Map();
    for (const item of items) {
        const existing = ids.get(item.migration.id);
        if (existing) {
            throw new Error(
                `Duplicate migration id '${item.migration.id}' in '${existing}' and '${item.filePath}'.`,
            );
        }
        ids.set(item.migration.id, item.filePath);

        if (!/^\d{14}_[A-Za-z0-9_]+$/.test(item.migration.id)) {
            throw new Error(
                `Migration '${item.filePath}' has invalid id '${item.migration.id}'. Expected YYYYMMDDHHMMSS_Name.`,
            );
        }
    }
}

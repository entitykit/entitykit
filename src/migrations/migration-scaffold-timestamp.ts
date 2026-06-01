/**
 * The identity of a scaffolded migration: its ordered timestamp id and its
 * PascalCase class name.
 *
 * Timestamps carry only second resolution, so `nextMigrationTimestamp` advances
 * past the newest migration already on disk to keep ids strictly monotonic —
 * that ordering is what the runner applies migrations by. `toPascalIdentifier`
 * turns a free-form migration name into a valid class identifier.
 */
import fs from 'fs';

/** Perform the format migration timestamp operation. */ export function formatMigrationTimestamp(date: Date): string {
    const pad = (value: number): string => value.toString().padStart(2, '0');
    return [
        date.getUTCFullYear(),
        pad(date.getUTCMonth() + 1),
        pad(date.getUTCDate()),
        pad(date.getUTCHours()),
        pad(date.getUTCMinutes()),
        pad(date.getUTCSeconds()),
    ].join('');
}

export function toPascalIdentifier(value: string): string {
    const normalized = value
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
    return normalized || 'Migration';
}

/**
 * The migration timestamp to use, never earlier than one second after the
 * newest migration already on disk.
 */
export function nextMigrationTimestamp(now: Date, migrationsDir: string): string {
    let candidate = formatMigrationTimestamp(now);
    const newest = newestMigrationTimestamp(migrationsDir);
    if (newest !== undefined && candidate <= newest) {
        candidate = formatMigrationTimestamp(new Date(parseMigrationTimestamp(newest).getTime() + 1000));
    }

    return candidate;
}

function newestMigrationTimestamp(migrationsDir: string): string | undefined {
    if (!fs.existsSync(migrationsDir)) {
        return undefined;
    }

    const timestamps = fs.readdirSync(migrationsDir)
        .map(fileName => /^(\d{14})_/.exec(fileName)?.[1])
        .filter((value): value is string => value !== undefined)
        .sort();

    return timestamps.at(-1);
}

function parseMigrationTimestamp(timestamp: string): Date {
    return new Date(Date.UTC(
        Number(timestamp.slice(0, 4)),
        Number(timestamp.slice(4, 6)) - 1,
        Number(timestamp.slice(6, 8)),
        Number(timestamp.slice(8, 10)),
        Number(timestamp.slice(10, 12)),
        Number(timestamp.slice(12, 14)),
    ));
}

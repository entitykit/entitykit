import type { ValueConverter } from './converter';

const DATE_ONLY_TEXT = /^(\d{4})-(\d{2})-(\d{2})/;

/** Perform the date only as string operation. */ export function dateOnlyAsString(): ValueConverter<string> {
    return {
        toProvider(value: string): unknown {
            return readDateOnly(value);
        },
        fromProvider(value: unknown): string {
            return readDateOnly(value);
        },
    };
}

/** Perform the date only as utc date operation. */ export function dateOnlyAsUtcDate(): ValueConverter<Date> {
    return {
        toProvider(value: Date): unknown {
            return formatDateOnly(
                value.getUTCFullYear(),
                value.getUTCMonth() + 1,
                value.getUTCDate(),
            );
        },
        fromProvider(value: unknown): Date {
            return new Date(`${readDateOnly(value)}T00:00:00.000Z`);
        },
    };
}

function readDateOnly(value: unknown): string {
    if (value instanceof Date) {
        return formatDateOnly(
            value.getFullYear(),
            value.getMonth() + 1,
            value.getDate(),
        );
    }

    const text = String(value);
    const match = DATE_ONLY_TEXT.exec(text);
    if (!match) {
        throw new Error(
            `Cannot read a date column from '${text}'. `
      + 'Expected a YYYY-MM-DD value.',
        );
    }

    return `${match[1]}-${match[2]}-${match[3]}`;
}

function formatDateOnly(
    year: number,
    month: number,
    day: number,
): string {
    return `${String(year).padStart(4, '0')}-`
    + `${String(month).padStart(2, '0')}-`
    + String(day).padStart(2, '0');
}

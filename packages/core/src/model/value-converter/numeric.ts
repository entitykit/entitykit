import type { ValueConverter } from './converter';

/** Perform the numeric as string operation. */ export function numericAsString(): ValueConverter<string> {
    return {
        toProvider(value: string): unknown {
            return value;
        },
        fromProvider(value: unknown): string {
            return typeof value === 'string' ? value : String(value);
        },
    };
}

/** Perform the numeric as number operation. */ export function numericAsNumber(): ValueConverter<number> {
    return {
        toProvider(value: number): unknown {
            return value;
        },
        fromProvider(value: unknown): number {
            return typeof value === 'number' ? value : Number(value);
        },
    };
}

/** Perform the bigint as big int operation. */ export function bigintAsBigInt(): ValueConverter<bigint> {
    return {
        toProvider(value: bigint): unknown {
            return value.toString();
        },
        fromProvider(value: unknown): bigint {
            if (typeof value === 'bigint') {
                return value;
            }
            if (typeof value === 'number' || typeof value === 'string') {
                return BigInt(value);
            }

            throw new Error(
                `Cannot read a bigint column from a ${typeof value} value.`,
            );
        },
    };
}

/** Perform the bigint as number operation. */ export function bigintAsNumber(): ValueConverter<number> {
    return {
        toProvider(value: number): unknown {
            return value;
        },
        fromProvider(value: unknown): number {
            const result = typeof value === 'number' ? value : Number(value);
            if (!Number.isSafeInteger(result)) {
                throw new Error(
                    `Bigint column value '${String(value)}' is outside the safe integer `
          + 'range. Use bigintAsBigInt() to keep the full 64-bit range.',
                );
            }

            return result;
        },
    };
}

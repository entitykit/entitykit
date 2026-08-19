export type QueryCountValue = bigint | number | string;

export function queryCountBigInt(value: QueryCountValue): bigint {
    if (typeof value === 'bigint') {
        return assertNonNegative(value);
    }
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value) || value < 0) {
            throw new RangeError(
                'The provider returned a count that is not a non-negative safe integer. Configure it to return bigint or an integer string.',
            );
        }
        return BigInt(value);
    }
    if (!/^\d+$/.test(value)) {
        throw new TypeError(
            `The provider returned a non-integer count value '${value}'.`,
        );
    }
    return BigInt(value);
}

export function queryCountNumber(value: QueryCountValue): number {
    const count = queryCountBigInt(value);
    if (count > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new RangeError(
            `The query count ${count.toString()} exceeds Number.MAX_SAFE_INTEGER. Use countBigInt() to preserve precision.`,
        );
    }
    return Number(count);
}

function assertNonNegative(value: bigint): bigint {
    if (value < 0n) {
        throw new RangeError('The provider returned a negative count value.');
    }
    return value;
}

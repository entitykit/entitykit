export interface InPredicateValues {
    readonly values: readonly unknown[];
    readonly includesNull: boolean;
}

export function isSqlNull(value: unknown): boolean {
    return value === null || value === undefined;
}

export function readInPredicateValues(
    value: unknown,
    invalidValueMessage: string,
): InPredicateValues {
    if (!Array.isArray(value)) {
        throw new Error(invalidValueMessage);
    }

    return {
        values: value.filter(item => !isSqlNull(item)),
        includesNull: value.some(isSqlNull),
    };
}

export function compileInPredicate(
    expression: string,
    values: InPredicateValues,
    addParameter: (value: unknown) => string,
    falsePredicate: () => string,
): string {
    if (values.values.length === 0) {
        return values.includesNull
            ? `${expression} is null`
            : falsePredicate();
    }

    const placeholders = values.values.map(addParameter).join(', ');
    const membership = `${expression} in (${placeholders})`;
    return values.includesNull
        ? `(${membership} or ${expression} is null)`
        : membership;
}

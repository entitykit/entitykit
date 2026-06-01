import {
    isProjectionField,
    isProjectionLiteral,
    isSqlExpression,
} from './projection-tokens';
import type {
    ProjectionExpression,
    ProjectionSelection,
} from './projection-types';

interface PendingProjection {
    readonly path: readonly string[];
    readonly value: unknown;
}

export function createProjectionExpression(
    selection: ProjectionSelection,
): ProjectionExpression[] {
    const pending: PendingProjection[] = [];
    collectSelection(selection, [], pending, new Set());
    if (pending.length === 0) {
        throw new Error('Projection selectors must select at least one value.');
    }

    const usedAliases = new Set(pending
        .filter(item => item.path.length === 1)
        .map(item => item.path[0]));
    let nestedAlias = 0;
    return pending.map(item => {
        const alias = item.path.length === 1
            ? item.path[0]
            : nextNestedAlias(usedAliases, () => nestedAlias++);
        const path = item.path.length === 1 ? undefined : item.path;
        return outputExpression(alias, path, item.value);
    });
}

function collectSelection(
    selection: ProjectionSelection,
    parentPath: readonly string[],
    output: PendingProjection[],
    ancestors: Set<object>,
): void {
    assertNestedSelection(selection, parentPath);
    if (ancestors.has(selection)) {
        throw new Error(
            `Projection path '${formatPath(parentPath)}' contains a cycle.`,
        );
    }
    ancestors.add(selection);
    const entries = Object.entries(selection);
    if (entries.length === 0 && parentPath.length > 0) {
        throw new Error(
            `Projection path '${formatPath(parentPath)}' must select at least one value.`,
        );
    }
    for (const [key, value] of entries) {
        const path = [...parentPath, key];
        if (isProjectionValue(value)) {
            output.push({ path, value });
        } else {
            collectSelection(
                value as ProjectionSelection,
                path,
                output,
                ancestors,
            );
        }
    }
    ancestors.delete(selection);
}

function outputExpression(
    alias: string,
    path: readonly string[] | undefined,
    value: unknown,
): ProjectionExpression {
    if (isProjectionField(value)) {
        return {
            kind: 'field',
            alias,
            path,
            sourceAlias: value.sourceAlias,
            propertyName: value.propertyName,
        };
    }
    if (isProjectionLiteral(value)) {
        return { kind: 'literal', alias, path, value: value.value };
    }
    if (isSqlExpression(value)) {
        return {
            kind: 'computed',
            alias,
            path,
            expression: value.expression,
            materialization: value.materialization,
        };
    }
    throw new Error(
        `Projection path '${formatPath(path ?? [alias])}' must select a mapped field, literal, SQL expression, or nested object.`,
    );
}

function assertNestedSelection(
    value: unknown,
    path: readonly string[],
): asserts value is ProjectionSelection {
    const prototype: unknown =
        value && typeof value === 'object'
            ? Object.getPrototypeOf(value)
            : undefined;
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        prototype !== Object.prototype && prototype !== null
    ) {
        throw new Error(path.length === 0
            ? 'Projection selectors must return a plain object.'
            : `Projection path '${formatPath(path)}' must select a mapped field, literal, SQL expression, or plain nested object.`);
    }
}

function isProjectionValue(value: unknown): boolean {
    return isProjectionField(value) ||
        isProjectionLiteral(value) ||
        isSqlExpression(value);
}

function nextNestedAlias(
    used: Set<string>,
    next: () => number,
): string {
    let alias: string;
    do {
        alias = `__entitykit_projection_${String(next())}`;
    } while (used.has(alias));
    used.add(alias);
    return alias;
}

function formatPath(path: readonly string[]): string {
    return path.length > 0 ? path.join('.') : '<root>';
}

import type { QueryModel } from '../query/query-model';

export type ProjectionFieldReader = (
    sourceAlias: string | undefined,
    propertyName: string,
    value: unknown,
) => unknown;

export function materializeProjectionRows<
    TEntity extends object,
    TProjection extends Record<string, unknown>,
>(
    model: QueryModel<TEntity>,
    rows: ReadonlyArray<Record<string, unknown>>,
    readField: ProjectionFieldReader,
): TProjection[] {
    const projection = model.projection ?? [];
    return rows.map(row => {
        const output: Record<string, unknown> = {};
        for (const item of projection) {
            const value = materializeProjectionValue(
                item,
                row[item.alias],
                readField,
            );
            setProjectionValue(output, item.path ?? [item.alias], value);
        }
        return output as TProjection;
    });
}

function materializeProjectionValue(
    item: NonNullable<QueryModel['projection']>[number],
    value: unknown,
    readField: ProjectionFieldReader,
): unknown {
    if (item.kind === 'literal') {
        return value;
    }
    if (item.kind === 'field') {
        return readField(item.sourceAlias, item.propertyName, value);
    }
    if (
        value === null ||
        value === undefined ||
        item.materialization.kind === 'raw'
    ) {
        return value;
    }
    if (item.materialization.kind === 'number') {
        return Number(value);
    }
    if (!item.materialization.propertyName) {
        throw new Error(
            `Computed projection '${item.alias}' has no materialization property.`,
        );
    }
    return readField(
        item.materialization.sourceAlias,
        item.materialization.propertyName,
        value,
    );
}

function setProjectionValue(
    output: Record<string, unknown>,
    path: readonly string[],
    value: unknown,
): void {
    let current = output;
    path.forEach((key, index) => {
        if (index === path.length - 1) {
            defineProjectionProperty(current, key, value);
            return;
        }
        const existing = current[key];
        if (
            Object.prototype.hasOwnProperty.call(current, key) &&
            existing &&
            typeof existing === 'object'
        ) {
            current = existing as Record<string, unknown>;
            return;
        }
        const nested: Record<string, unknown> = {};
        defineProjectionProperty(current, key, nested);
        current = nested;
    });
}

function defineProjectionProperty(
    target: Record<string, unknown>,
    key: string,
    value: unknown,
): void {
    Object.defineProperty(target, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
    });
}

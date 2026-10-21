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
        let rootIsPrivate = true;
        for (const item of projection) {
            const value = materializeProjectionValue(
                item,
                row[item.alias],
                readField,
            );
            rootIsPrivate = setProjectionValue(
                output, item.path ?? [item.alias], value, rootIsPrivate,
            );
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
    rootIsPrivate: boolean,
): boolean {
    let current = output;
    const length = path.length;
    for (let index = 0; index < length; index++) {
        if (!(index in path)) {
            continue;
        }
        const key = path[index];
        if (index === path.length - 1) {
            // A private root has only writable data properties. Once an
            // ancestor lookup can expose it, every later write must define.
            if (rootIsPrivate && current === output && !Object.hasOwn(Object.prototype, key)) {
                current[key] = value;
            } else {
                defineResultProperty(current, key, value);
            }
            continue;
        }
        // Even an inherited getter receives the root as its receiver and can
        // change its own descriptors or prototype before another field writes.
        rootIsPrivate = false;
        const existing = current[key];
        if (
            Object.prototype.hasOwnProperty.call(current, key) &&
            existing &&
            typeof existing === 'object'
        ) {
            current = existing as Record<string, unknown>;
            continue;
        }
        const nested: Record<string, unknown> = {};
        defineResultProperty(current, key, nested);
        current = nested;
    }
    return rootIsPrivate;
}

export function defineResultProperty(
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

import { navigationValueChanged } from './navigation-snapshot';

/** Assign one navigation and reject an accessor that refuses the value. */
export function writeVerifiedNavigation(
    entity: object,
    navigationProperty: string,
    value: unknown,
    entityName: string,
): unknown {
    const expected = cloneNavigationAssignment(value);
    const values = entity as Record<string, unknown>;
    values[navigationProperty] = value;
    const actual = values[navigationProperty];
    if (navigationValueChanged(expected, actual)) {
        throw new Error(
            `Navigation '${entityName}.${navigationProperty}' refused its assigned value.`,
        );
    }
    return actual;
}

function cloneNavigationAssignment(value: unknown): unknown {
    return isUnknownArray(value) ? [...value] : value;
}

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

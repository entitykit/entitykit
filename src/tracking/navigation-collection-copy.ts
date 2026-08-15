/** Copy an array container without cloning the entities it holds. */
export function cloneNavigationContainer(value: unknown): unknown {
    return isUnknownArray(value) ? [...value] : value;
}

/** Copy a navigation collection into a fresh array a caller may mutate. */
export function copyNavigationCollection(value: unknown): unknown[] {
    return isUnknownArray(value) ? [...value] : [];
}

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

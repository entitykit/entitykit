const guards: WeakMap<object, () => void> = new WeakMap();

export function configureEntityEntryMutationGuard(
    entry: object,
    guard: () => void,
): void {
    guards.set(entry, guard);
}

export function assertEntityEntryStateMutation(entry: object): void {
    guards.get(entry)?.();
}

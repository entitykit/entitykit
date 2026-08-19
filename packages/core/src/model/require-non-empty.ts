export function requireNonEmpty(value: string, name: string): string {
    const normalized = value.trim();
    if (!normalized) {
        throw new Error(`${name} must not be empty.`);
    }
    return normalized;
}

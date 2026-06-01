/** Extract a MySQL enum union, or undefined when the store type is not an enum. */
export function mapEnumType(storeType: string): string | undefined {
    const trimmed = storeType.trim();
    if (!trimmed.toLowerCase().startsWith('enum(')) {
        return undefined;
    }

    const inner = trimmed.slice(
        trimmed.indexOf('(') + 1,
        trimmed.lastIndexOf(')'),
    );
    const members: string[] = [];
    const pattern = /'((?:[^']|'')*)'/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(inner)) !== null) {
        members.push(match[1].replace(/''/g, '\''));
    }

    return members.length > 0
        ? members.map(member => JSON.stringify(member)).join(' | ')
        : undefined;
}

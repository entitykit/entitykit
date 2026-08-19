import type { CheckConstraintMetadata } from './check-constraint-metadata';

/** Entity-level schema objects that are not properties, keys, or relationships. */
export class EntityBuilderSchema {
    private readonly checks: CheckConstraintMetadata[] = [];

    public checkConstraint(name: string, sql: string): void {
        const normalizedName = requireText(name, 'Check constraint name');
        const normalizedSql = requireText(sql, 'Check constraint SQL');
        if (this.checks.some(check => check.name === normalizedName)) {
            throw new Error(`Check constraint '${normalizedName}' is configured more than once.`);
        }
        this.checks.push({ name: normalizedName, sql: normalizedSql });
    }

    public finalize(): readonly CheckConstraintMetadata[] {
        return this.checks.map(check => ({ ...check }));
    }
}

function requireText(value: string, label: string): string {
    const normalized = value.trim();
    if (!normalized) {
        throw new Error(`${label} must not be empty.`);
    }
    return normalized;
}

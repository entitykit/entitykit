interface CachedSelectSql {
    readonly text: string;
}

export class SelectSqlCache {
    private readonly entries: Map<string, CachedSelectSql> = new Map();

    constructor(private readonly maxEntries: number) {}

    public get(cacheKey: string): CachedSelectSql | undefined {
        const cached = this.entries.get(cacheKey);
        if (!cached) {
            return undefined;
        }

        this.entries.delete(cacheKey);
        this.entries.set(cacheKey, cached);
        return cached;
    }

    public set(cacheKey: string, sql: CachedSelectSql): void {
        if (this.maxEntries <= 0) {
            return;
        }

        if (this.entries.has(cacheKey)) {
            this.entries.delete(cacheKey);
        }
        this.entries.set(cacheKey, sql);

        while (this.entries.size > this.maxEntries) {
            const oldestKey = this.entries.keys().next().value;
            if (oldestKey === undefined) {
                return;
            }
            this.entries.delete(oldestKey);
        }
    }
}

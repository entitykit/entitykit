import type { EntityEntry } from '../tracking/entity-entry';

interface SaveTimeMutation {
    restore(): void;
}

/** Records temporary entity writes so a failed save can put them back. */
export class SaveTimeMutationLog {
    private mutations: SaveTimeMutation[] = [];

    public reset(): void {
        this.mutations = [];
    }

    public record(values: Record<string, unknown>, property: string): void {
        const previous = values[property];
        this.mutations.push({
            restore: () => {
                values[property] = previous;
            },
        });
    }

    public recordState(entry: EntityEntry<object>): void {
        const previous = entry.state;
        this.mutations.push({
            restore: () => {
                entry.state = previous;
            },
        });
    }

    public restore(): void {
        for (const mutation of [...this.mutations].reverse()) {
            mutation.restore();
        }
        this.reset();
    }

    public accept(): void {
        this.reset();
    }
}

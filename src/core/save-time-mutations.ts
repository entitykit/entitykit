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
        this.recordCaptured(values, property, values[property]);
    }

    /** Record a value already read by the executable entity capture. */
    public recordCaptured(
        values: Record<string, unknown>,
        property: string,
        previous: unknown,
    ): void {
        this.mutations.push({
            restore: () => {
                values[property] = previous;
            },
        });
    }

    /** Restore a policy write only while its provisional value is still live. */
    public recordApplied(
        values: Record<string, unknown>,
        property: string,
        previous: unknown,
        applied: unknown,
    ): void {
        this.mutations.push({
            restore: () => {
                if (Object.is(values[property], applied)) {
                    values[property] = previous;
                }
            },
        });
    }

    public recordAppliedState(
        entry: EntityEntry<object>,
        previous: EntityEntry<object>['state'],
        applied: EntityEntry<object>['state'],
    ): void {
        this.mutations.push({
            restore: () => {
                if (entry.state === applied) {
                    entry.state = previous;
                }
            },
        });
    }

    public restore(): void {
        this.takeRollback()();
    }

    public accept(): void {
        this.reset();
    }

    /** Accept the mutations now while retaining a one-shot rollback journal. */
    public takeRollback(): () => void {
        const accepted = this.mutations;
        this.mutations = [];
        let pending = true;
        return () => {
            if (!pending) {
                return;
            }
            pending = false;
            for (const mutation of [...accepted].reverse()) {
                mutation.restore();
            }
        };
    }
}

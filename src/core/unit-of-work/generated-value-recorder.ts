import type { ChangeTracker } from '../../tracking/change-tracker';
import type {
    AppliedGeneratedValue,
    AppliedPropertyValue,
} from './applied-generated-value';

export class GeneratedValueRecorder {
    private readonly values: AppliedGeneratedValue[] = [];

    constructor(private readonly changeTracker: ChangeTracker) {}

    public record(
        entity: object,
        values: readonly AppliedPropertyValue[],
    ): void {
        const entry = this.changeTracker.entry(entity);
        if (!entry) {
            throw new Error('Generated values require their entity to remain tracked.');
        }
        for (const value of values) {
            this.values.push({ entry, ...value });
        }
    }

    public take(): readonly AppliedGeneratedValue[] {
        return this.values.splice(0);
    }
}

import type { RecordedDatabaseOperation } from './recorded-database-operation';

export class RecordingSession {
    private depth = 0;

    constructor(
        private readonly operations: RecordedDatabaseOperation[],
        private readonly events: string[],
    ) {}

    public async run<TResult>(work: () => TResult | Promise<TResult>): Promise<TResult> {
        if (this.depth > 0) {
            return work();
        }

        this.depth += 1;
        this.operations.push({ kind: 'session-start' });
        this.events.push('start');

        try {
            return await work();
        } finally {
            this.operations.push({ kind: 'session-end' });
            this.events.push('end');
            this.depth -= 1;
        }
    }
}

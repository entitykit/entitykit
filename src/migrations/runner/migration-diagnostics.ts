import type {
    MigrationDiagnosticEvent,
} from '../../diagnostics/runtime/events';
import type { MigrationSqlDialect } from '../migration-sql-dialect';
import type { MigrationRunnerDiagnosticsOptions } from './migration-runner-options';
import { startElapsedTimer } from '../../diagnostics/runtime/elapsed-time';

export class MigrationDiagnostics {
    constructor(
        private readonly dialect: MigrationSqlDialect,
        private readonly options: MigrationRunnerDiagnosticsOptions,
    ) {}

    public async runLock(
        phase: 'lockAcquire' | 'lockRelease',
        work: () => unknown,
    ): Promise<void> {
        const elapsed = startElapsedTimer();
        try {
            await work();
            this.emit({ phase, durationMs: elapsed() });
        } catch (error) {
            this.emit({ phase, durationMs: elapsed(), error });
            throw error;
        }
    }

    public emit(event: Omit<MigrationDiagnosticEvent, 'kind' | 'provider'>): void {
        const handlers = this.options.diagnostics ?? [];
        if (handlers.length === 0) {
            return;
        }

        const diagnostic: MigrationDiagnosticEvent = {
            kind: 'migration',
            provider: this.options.provider ?? this.dialect.name,
            ...event,
        };

        for (const handler of handlers) {
            handler(diagnostic);
        }
    }
}

import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import {
    ContextConcurrentOperationError,
    DbContext,
    EntityState,
} from '../packages/core/src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class Row {
    public id!: string;
    public name!: string;
    public updatedAt!: Date;
}

type ReentrantOperation = 'plan' | 'debug' | 'clear';

class ReentrantContext extends DbContext {
    public rows = this.set(Row);

    constructor(
        private readonly connection: RecordingDatabaseConnection,
        private readonly operation: ReentrantOperation,
    ) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options
            .useConnection(this.connection)
            .useAuditing({
                now: () => new Date('2026-08-03T12:00:00.000Z'),
            })
            .useSaveInterceptor({
                savingChanges: () => {
                    if (this.operation === 'plan') this.getSavePlan();
                    if (this.operation === 'debug') this.getSavePlanDebugView();
                    if (this.operation === 'clear') this.clearChanges();
                },
            });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Row, entity => {
            entity.toTable('rows');
            entity.hasKey(row => row.id);
            entity.audit({ updatedAt: 'updatedAt' });
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
            entity.property(row => row.updatedAt).hasColumnType('timestamptz').isRequired();
        });
    }
}

describe('save-plan reentrancy', () => {
    it.each<ReentrantOperation>(['plan', 'debug', 'clear'])(
        'rejects %s access without replacing the active save journal',
        async operation => {
            const connection = new RecordingDatabaseConnection();
            const db = ReentrantContext.create(connection, operation);
            const original = new Date('2026-08-03T10:00:00.000Z');
            const row = Object.assign(new Row(), {
                id: 'row_1',
                name: 'before',
                updatedAt: original,
            });
            db.rows.attach(row);
            row.name = 'after';

            await expect(db.saveChanges()).rejects.toBeInstanceOf(
                ContextConcurrentOperationError,
            );

            expect(row.updatedAt).toEqual(original);
            expect(db.entry(row)?.state).toBe(EntityState.Modified);
            expect(connection.statements).toEqual([]);
        },
    );
});

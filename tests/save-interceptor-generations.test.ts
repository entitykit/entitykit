import type {
    DbContextOptionsBuilder,
    ModelBuilder,
    SaveChangesInterceptor,
} from '../packages/core/src';
import { DbContext, EntityState } from '../packages/core/src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

const originalTime = new Date('2026-01-01T00:00:00.000Z');
const saveTime = new Date('2026-08-05T12:00:00.000Z');

class GenerationRow {
    public id = '';
    public name = '';
    public createdAt?: Date;
    public updatedAt?: Date;
    public deletedAt: Date | null = null;
}

class GenerationContext extends DbContext {
    public rows = this.set(GenerationRow);

    public static createWith(
        connection: RecordingDatabaseConnection,
        ...interceptors: readonly SaveChangesInterceptor[]
    ): GenerationContext {
        return GenerationContext.create(connection, interceptors);
    }

    constructor(
        private readonly connection: RecordingDatabaseConnection,
        private readonly interceptors: readonly SaveChangesInterceptor[],
    ) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection).useAuditing({ now: () => saveTime });
        for (const interceptor of this.interceptors) {
            options.useSaveInterceptor(interceptor);
        }
    }

    protected override model(model: ModelBuilder): void {
        model.entity(GenerationRow, entity => {
            entity.toTable('generation_rows');
            entity.hasKey(row => row.id);
            entity.audit({
                createdAt: row => row.createdAt,
                updatedAt: row => row.updatedAt,
            });
            entity.softDelete(row => row.deletedAt);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
            entity.property(row => row.createdAt).hasColumnName('created_at')
                .hasColumnType('timestamptz').isRequired();
            entity.property(row => row.updatedAt).hasColumnName('updated_at')
                .hasColumnType('timestamptz').isRequired();
            entity.property(row => row.deletedAt).hasColumnName('deleted_at')
                .hasColumnType('timestamptz');
        });
    }
}

function existing(id = 'existing'): GenerationRow {
    return Object.assign(new GenerationRow(), {
        id,
        name: 'original',
        createdAt: originalTime,
        updatedAt: originalTime,
    });
}

function added(id: string): GenerationRow {
    return Object.assign(new GenerationRow(), { id, name: id });
}

describe('save interceptor plan generations', () => {
    it('does not persist an audit-only update after the business change is reverted', async () => {
        const connection = new RecordingDatabaseConnection();
        const row = existing();
        const db = GenerationContext.createWith(connection, {
            savingChanges: () => {
                row.name = 'original';
            },
        });
        db.rows.attach(row);
        row.name = 'changed';

        await expect(db.saveChanges()).resolves.toBe(0);

        expect(row.updatedAt).toEqual(originalTime);
        expect(db.entry(row)?.state).toBe(EntityState.Unchanged);
        expect(connection.statements).toEqual([]);
    });

    it('restores a detached soft-delete preview while another row saves', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        const removed = existing('removed');
        const kept = added('kept');
        const db = GenerationContext.createWith(connection, {
            savingChanges: () => {
                db.rows.detach(removed);
            },
        });
        db.rows.attach(removed);
        db.rows.remove(removed);
        db.rows.add(kept);

        await expect(db.saveChanges()).resolves.toBe(1);

        expect(removed.deletedAt).toBeNull();
        expect(db.entry(removed)).toBeUndefined();
        expect(connection.statements).toHaveLength(1);
        expect(connection.statements[0]?.values).toContain('kept');
        expect(connection.statements[0]?.values).not.toContain('removed');
    });

    it('restores audit fields on a detached modified row', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        const removed = existing('removed');
        const kept = added('kept');
        const db = GenerationContext.createWith(connection, {
            savingChanges: () => {
                db.rows.detach(removed);
            },
        });
        db.rows.attach(removed);
        removed.name = 'changed';
        db.rows.add(kept);

        await expect(db.saveChanges()).resolves.toBe(1);

        expect(removed.updatedAt).toEqual(originalTime);
        expect(db.entry(removed)).toBeUndefined();
        expect(connection.statements).toHaveLength(1);
        expect(connection.statements[0]?.values).toContain('kept');
    });

    it('isolates each ordered interceptor plan generation', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        const original = existing();
        const discarded = added('discarded');
        const final = added('final');
        const observed: object[] = [];
        const db = GenerationContext.createWith(connection, {
            savingChanges: () => {
                original.name = 'original';
                db.rows.add(discarded);
            },
        }, {
            savingChanges: event => {
                observed.push(...event.plan.map(entry => entry.entity));
                db.rows.remove(discarded);
                db.rows.add(final);
            },
        });
        db.rows.attach(original);
        original.name = 'changed';

        await expect(db.saveChanges()).resolves.toBe(1);

        expect(observed).toEqual([discarded]);
        expect(original.updatedAt).toEqual(originalTime);
        expect(discarded.createdAt).toBeUndefined();
        expect(discarded.updatedAt).toBeUndefined();
        expect(final.createdAt).toEqual(saveTime);
        expect(final.updatedAt).toEqual(saveTime);
        expect(connection.statements[0]?.values).toContain('final');
        expect(connection.statements[0]?.values).not.toContain('discarded');
    });

    it('accepts only the final generation after an outer commit', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        const row = existing();
        const db = GenerationContext.createWith(connection, {
            savingChanges: () => {
                row.name = 'final';
            },
        });
        db.rows.attach(row);
        row.name = 'initial';

        await db.transaction(async transaction => {
            await expect(transaction.saveChanges()).resolves.toBe(1);
        });

        expect(row.name).toBe('final');
        expect(row.updatedAt).toEqual(saveTime);
        expect(db.entry(row)?.state).toBe(EntityState.Unchanged);
    });

    it('restores the final generation after an outer rollback', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        const row = existing();
        const db = GenerationContext.createWith(connection, {
            savingChanges: () => {
                row.name = 'final';
            },
        });
        db.rows.attach(row);
        row.name = 'initial';

        await expect(db.transaction(async transaction => {
            await transaction.saveChanges();
            throw new Error('rollback');
        })).rejects.toThrow('rollback');

        expect(row.name).toBe('final');
        expect(row.updatedAt).toEqual(originalTime);
        expect(db.entry(row)?.state).toBe(EntityState.Modified);
    });

    it('restores the final generation after provider failure', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueError(new Error('provider failed'));
        const row = existing();
        const db = GenerationContext.createWith(connection, {
            savingChanges: () => {
                row.name = 'final';
            },
        });
        db.rows.attach(row);
        row.name = 'initial';

        await expect(db.saveChanges()).rejects.toThrow('provider failed');

        expect(row.name).toBe('final');
        expect(row.updatedAt).toEqual(originalTime);
        expect(db.entry(row)?.state).toBe(EntityState.Modified);
        expect(connection.transactionEvents).toEqual(['begin', 'rollback']);
    });
});

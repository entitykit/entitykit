import type {
    DbContextOptionsBuilder,
    ModelBuilder,
    SaveChangesInterceptor,
} from '../src';
import { DbContext, EntityState } from '../src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';
import { requireDefined } from './support/require-defined';

const saveTime = new Date('2026-08-06T12:00:00.000Z');

class AuditStamp {
    public updatedAt?: Date;
    public note?: string;
}

class AuditedRow {
    public id = '';
    public name = '';
    public audit: AuditStamp | null = null;
}

class AuditContext extends DbContext {
    public rows = this.set(AuditedRow);

    public static createWith(
        connection: RecordingDatabaseConnection,
        ...interceptors: readonly SaveChangesInterceptor[]
    ): AuditContext {
        return AuditContext.create(connection, interceptors);
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
        model.entity(AuditedRow, entity => {
            entity.toTable('audited_rows');
            entity.hasKey(row => row.id);
            entity.audit({ updatedAt: row => row.audit.updatedAt });
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
            entity.complexProperty(
                row => row.audit,
                { constructor: AuditStamp },
                audit => {
                    audit.property(value => value.updatedAt)
                        .hasColumnName('updated_at').hasColumnType('timestamptz');
                    audit.property(value => value.note)
                        .hasColumnName('note').hasColumnType('text');
                },
            );
        });
    }
}

function modifiedRow(): AuditedRow {
    return Object.assign(new AuditedRow(), {
        id: 'row-1',
        name: 'before',
    });
}

function trackModified(db: AuditContext, row: AuditedRow): void {
    db.rows.attach(row);
    row.name = 'after';
}

describe('complex policy interceptor rebuild rollback', () => {
    it('preserves a same-object interceptor mutation across plan rebuilds', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        const row = modifiedRow();
        let created: AuditStamp | undefined;
        const db = AuditContext.createWith(connection, {
            savingChanges: () => {
                created = row.audit ?? undefined;
                requireDefined(row.audit).note = 'same object';
            },
        });
        trackModified(db, row);

        await expect(db.saveChanges()).resolves.toBe(1);

        expect(row.audit).toBe(created);
        expect(row.audit).toEqual(Object.assign(new AuditStamp(), {
            note: 'same object',
            updatedAt: saveTime,
        }));
        expect(connection.statements[0]?.values).toEqual(
            expect.arrayContaining(['after', 'same object', saveTime]),
        );
    });

    it('preserves a replacement for later ordered interceptors and persistence', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        const row = modifiedRow();
        const replacement = Object.assign(new AuditStamp(), { note: 'replacement' });
        const observed: unknown[] = [];
        const db = AuditContext.createWith(connection, {
            savingChanges: () => {
                row.audit = replacement;
            },
        }, {
            savingChanges: () => {
                observed.push(row.audit, row.audit?.updatedAt, row.audit?.note);
                requireDefined(row.audit).note = 'ordered';
            },
        });
        trackModified(db, row);

        await expect(db.saveChanges()).resolves.toBe(1);

        expect(observed).toEqual([replacement, saveTime, 'replacement']);
        expect(row.audit).toBe(replacement);
        expect(row.audit).toEqual(Object.assign(new AuditStamp(), {
            note: 'ordered',
            updatedAt: saveTime,
        }));
        expect(connection.statements[0]?.values).toEqual(
            expect.arrayContaining(['after', 'ordered', saveTime]),
        );
    });

    it('keeps a same-object mutation but rolls back its policy value on failure', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueError(new Error('provider failed'));
        const row = modifiedRow();
        let created: AuditStamp | undefined;
        const db = AuditContext.createWith(connection, {
            savingChanges: () => {
                created = row.audit ?? undefined;
                requireDefined(row.audit).note = 'survives failure';
            },
        });
        trackModified(db, row);

        await expect(db.saveChanges()).rejects.toThrow('provider failed');

        expect(row.audit).toBe(created);
        expect(row.audit?.note).toBe('survives failure');
        expect(row.audit?.updatedAt).toBeUndefined();
        expect(db.entry(row)?.state).toBe(EntityState.Modified);
        expect(connection.transactionEvents).toEqual(['begin', 'rollback']);
    });

    it('keeps a replacement but rolls back its policy value on outer rollback', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        const row = modifiedRow();
        const replacement = Object.assign(new AuditStamp(), {
            note: 'survives rollback',
        });
        const db = AuditContext.createWith(connection, {
            savingChanges: () => {
                row.audit = replacement;
            },
        });
        trackModified(db, row);

        await expect(db.transaction(async transaction => {
            await transaction.saveChanges();
            throw new Error('rollback');
        })).rejects.toThrow('rollback');

        expect(row.audit).toBe(replacement);
        expect(row.audit?.note).toBe('survives rollback');
        expect(row.audit?.updatedAt).toBeUndefined();
        expect(db.entry(row)?.state).toBe(EntityState.Modified);
        expect(connection.transactionEvents).toEqual([
            'begin',
            'savepoint:entitykit_sp_1',
            'release:entitykit_sp_1',
            'rollback',
        ]);
    });
});

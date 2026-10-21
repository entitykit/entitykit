import { DbContext, type DbContextOptionsBuilder, type ModelBuilder } from '../packages/core/src';
import * as saverModule from '../packages/core/src/core/unit-of-work-saver';
import { createSqliteDataSource } from '../packages/sqlite/src';

class SaverRow {
    public id = 1;
    public label = 'before';
}

class SaverContext extends DbContext {
    public readonly rows = this.set(SaverRow);
    public beforeSave?: () => void | Promise<void>;
    protected override configure(options: DbContextOptionsBuilder): void {
        options.useSaveInterceptor({ savingChanges: async () => this.beforeSave?.() });
    }
    protected override model(model: ModelBuilder): void {
        model.entity(SaverRow, entity => {
            entity.toTable('saver_rows').hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired();
        });
    }
}

async function seed(db: SaverContext): Promise<void> {
    await db.database.connection.query({ text: db.database.createScript(), values: [] });
    await db.database.connection.query({
        text: 'insert into saver_rows (id, label) values (1, \'before\')', values: [],
    });
}

const Saver = saverModule.UnitOfWorkSaver;

describe('lazy unit of work saver ownership', () => {
    let allocations: jest.SpyInstance<InstanceType<typeof Saver>, ConstructorParameters<typeof Saver>>;
    beforeEach(() => {
        allocations = jest.spyOn(saverModule, 'UnitOfWorkSaver')
            .mockImplementation((...args) => new Saver(...args));
    });
    afterEach(() => jest.restoreAllMocks());

    it('keeps reads, empty saves, previews and read-only transactions free of saver allocation', async () => {
        const source = createSqliteDataSource(':memory:');
        try {
            await using db = source.createContext(SaverContext);
            await seed(db);
            expect((await db.rows.asNoTracking().first()).label).toBe('before');
            expect(await db.rows.count()).toBe(1);
            expect(db.getSavePlan()).toEqual([]);
            expect(db.getSavePlanDebugView()).toEqual(expect.any(String));
            expect(await db.saveChanges()).toBe(0);
            await db.transaction(async () => {
                expect(await db.rows.count()).toBe(1);
                expect(await db.saveChanges()).toBe(0);
                await expect(db.dispose()).rejects.toThrow('while a transaction is open');
            });
            db.clearTracking();
            expect(allocations.mock.calls.length).toBe(0);
        } finally {
            await source.dispose();
        }
    });

    it('allocates at the first nonempty save and reuses the saver after acceptance and clear', async () => {
        const source = createSqliteDataSource(':memory:');
        try {
            await using db = source.createContext(SaverContext);
            await seed(db);
            const row = await db.rows.findOrThrow(1);
            row.label = 'first';
            expect(db.getSavePlan()).toHaveLength(1);
            expect(db.getSavePlanDebugView()).toEqual(expect.any(String));
            expect(allocations.mock.calls.length).toBe(0);
            expect(await db.saveChanges()).toBe(1);
            expect(allocations).toHaveBeenCalledTimes(1);
            row.label = 'second';
            expect(await db.saveChanges()).toBe(1);
            expect(await db.saveChanges()).toBe(0);
            db.clearTracking();
            const next = await db.rows.findOrThrow(1);
            expect(next.label).toBe('second');
            next.label = 'third';
            expect(await db.saveChanges()).toBe(1);
            expect((await db.rows.asNoTracking().first()).label).toBe('third');
            expect(allocations).toHaveBeenCalledTimes(1);
        } finally {
            await source.dispose();
        }
    });

    it('retains its saver after a provider failure and persists a later valid save', async () => {
        const source = createSqliteDataSource(':memory:');
        try {
            await using db = source.createContext(SaverContext);
            await seed(db);
            db.rows.add(new SaverRow());
            await expect(db.saveChanges()).rejects.toMatchObject({ code: 'DB_UNIQUE_CONSTRAINT' });
            expect(allocations).toHaveBeenCalledTimes(1);
            db.clearTracking();
            const valid = new SaverRow();
            valid.id = 2;
            valid.label = 'recovered';
            db.rows.add(valid);
            expect(await db.saveChanges()).toBe(1);
            expect((await db.rows.findOrThrow(1)).label).toBe('before');
            expect((await db.rows.asNoTracking().where(row => row.id.eq(2)).first()).label)
                .toBe('recovered');
            expect(allocations).toHaveBeenCalledTimes(1);
        } finally {
            await source.dispose();
        }
    });

    it('keeps saver state and providers separate between contexts', async () => {
        const firstSource = createSqliteDataSource(':memory:');
        const secondSource = createSqliteDataSource(':memory:');
        try {
            await using first = firstSource.createContext(SaverContext);
            await using second = secondSource.createContext(SaverContext);
            await seed(first);
            await seed(second);
            const a = await first.rows.findOrThrow(1);
            const b = await second.rows.findOrThrow(1);
            a.label = 'first';
            b.label = 'second';
            expect(await first.saveChanges()).toBe(1);
            expect(await second.saveChanges()).toBe(1);
            expect(allocations).toHaveBeenCalledTimes(2);
            first.clearTracking();
            second.clearTracking();
            expect((await first.rows.findOrThrow(1)).label).toBe('first');
            expect((await second.rows.findOrThrow(1)).label).toBe('second');
        } finally {
            await firstSource.dispose();
            await secondSource.dispose();
        }
    });

    it('keeps one saver and excludes overlapping saves while a live hook is awaiting', async () => {
        const source = createSqliteDataSource(':memory:');
        let entered!: () => void;
        let release!: () => void;
        const started: Promise<void> = new Promise(resolve => {
            entered = resolve;
        });
        const waiting: Promise<void> = new Promise(resolve => {
            release = resolve;
        });
        try {
            await using db = source.createContext(SaverContext);
            await seed(db);
            const row = await db.rows.findOrThrow(1);
            row.label = 'pending';
            db.beforeSave = async () => {
                entered();
                await waiting;
                row.label = 'hook';
            };
            const saving = db.saveChanges();
            try {
                await started;
                const overlapping = db.saveChanges();
                await expect(overlapping).rejects.toMatchObject({
                    code: 'CONTEXT_CONCURRENT_OPERATION',
                    details: { operation: 'saveChanges()' },
                });
                await expect(overlapping).rejects.toThrow('A saveChanges() is already in progress');
                for (const operation of ['getSavePlan', 'getSavePlanDebugView', 'clearTracking'] as const) {
                    let failure: unknown;
                    try {
                        db[operation]();
                    } catch (error) {
                        failure = error;
                    }
                    expect(failure).toMatchObject({
                        code: 'CONTEXT_CONCURRENT_OPERATION',
                        details: { operation: `${operation}()` },
                    });
                    expect(failure instanceof Error ? failure.message : undefined)
                        .toContain(`${operation}() cannot run while saveChanges() is in progress`);
                }
                expect(allocations).toHaveBeenCalledTimes(1);
            } finally {
                release();
                await saving;
            }
            expect((await db.rows.asNoTracking().first()).label).toBe('hook');
            expect(allocations).toHaveBeenCalledTimes(1);
        } finally {
            release();
            await source.dispose();
        }
    });

    it('checks cancellation and disposal before creating a saver', async () => {
        const source = createSqliteDataSource(':memory:');
        try {
            await using db = source.createContext(SaverContext);
            db.rows.add(new SaverRow());
            await expect(db.saveChanges({ signal: AbortSignal.abort() }))
                .rejects.toMatchObject({ code: 'OPERATION_CANCELED' });
            expect(allocations.mock.calls.length).toBe(0);
            await db.dispose();
            await expect(db.saveChanges()).rejects.toMatchObject({
                code: 'CONTEXT_DISPOSED', details: { operation: 'saveChanges()' },
            });
            for (const operation of ['getSavePlan', 'getSavePlanDebugView', 'clearTracking'] as const) {
                let failure: unknown;
                try {
                    db[operation]();
                } catch (error) {
                    failure = error;
                }
                expect(failure).toMatchObject({
                    code: 'CONTEXT_DISPOSED', details: { operation: `${operation}()` },
                });
            }
            expect(allocations.mock.calls.length).toBe(0);
        } finally {
            await source.dispose();
        }
    });
});

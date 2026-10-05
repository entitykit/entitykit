import type { DbContextOptionsBuilder, ModelBuilder, SaveChangesInterceptor } from '../packages/core/src';
import { DbContext, EntityState } from '../packages/core/src';
import { SavePlanBuilder } from '../packages/core/src/core/save-plan-builder';
import { sqliteProviderServices } from '../packages/sqlite/src';

class ObservedRow {
    public id = 0;
    public label = '';
}

class ObserverContext extends DbContext {
    public rows = this.set(ObservedRow);
    constructor(private readonly observers: readonly SaveChangesInterceptor[]) {
        super();
    }
    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
        for (const observer of this.observers) options.useSaveInterceptor(observer);
    }
    protected override model(model: ModelBuilder): void {
        model.entity(ObservedRow, entity => {
            entity.toTable('observed_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired();
        });
    }
}

describe('save observer plan work', () => {
    afterEach(() => jest.restoreAllMocks());

    it.each([0, 1, 3])('builds one plan with %i post-save-only observers', async count => {
        const observed: number[] = [];
        const observers = Array.from({ length: count }, (): SaveChangesInterceptor => ({
            savedChanges: event => {
                observed.push(event.affectedEntities);
            },
        }));
        const db = ObserverContext.create(observers);
        try {
            await db.database.ensureCreated();
            const plans = jest.spyOn(SavePlanBuilder.prototype, 'build');
            const row = Object.assign(new ObservedRow(), { id: 1, label: 'saved' });
            db.rows.add(row);
            await expect(db.saveChanges()).resolves.toBe(1);
            expect(plans).toHaveBeenCalledTimes(1);
            expect(observed).toEqual(Array<number>(count).fill(1));
            expect(db.entry(row)?.state).toBe(EntityState.Unchanged);
            db.changeTracker.clear();
            await expect(db.rows.find(1)).resolves.toMatchObject({ label: 'saved' });
        } finally {
            await db.dispose();
        }
    });

    it('reads a before-save callback once, preserves its receiver, and rebuilds its changes', async () => {
        const row = Object.assign(new ObservedRow(), { id: 1, label: 'before' });
        const observed: string[] = [];
        let callbackReads = 0;
        const callback: NonNullable<SaveChangesInterceptor['savingChanges']> = function (
            this: SaveChangesInterceptor,
        ): void {
            expect(this).toBe(interceptor);
            row.label = 'after';
        };
        const interceptor: SaveChangesInterceptor = {
            get savingChanges() {
                callbackReads++; return callback;
            },
        };
        const db = ObserverContext.create([
            { savedChanges: () => {
                observed.push(row.label);
            } },
            interceptor,
            { saveChangesFailed: () => {
                throw new Error('unexpected failure');
            } },
        ]);
        try {
            await db.database.ensureCreated();
            const plans = jest.spyOn(SavePlanBuilder.prototype, 'build');
            db.rows.add(row);
            await expect(db.saveChanges()).resolves.toBe(1);
            expect(plans).toHaveBeenCalledTimes(2);
            expect(callbackReads).toBe(1);
            expect(observed).toEqual(['after']);
            db.changeTracker.clear();
            await expect(db.rows.find(1)).resolves.toMatchObject({ label: 'after' });
        } finally {
            await db.dispose();
        }
    });
});

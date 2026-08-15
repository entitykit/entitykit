import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { ContextStateRestorationError, DbContext, EntityState } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import { savePlanExecution } from '../src/core/save-plan-execution';
import { acceptVersionIncrements } from '../src/core/unit-of-work/tracked-version-acceptance';
import { RestorationScope } from '../src/restoration-scope';

class AcceptanceParent {
    private storedId = 0;
    public name = '';
    public children: AcceptanceChild[] = [];
    public onGenerated?: (value: number) => void;
    public get id(): number {
        return this.storedId;
    }
    public set id(value: number) {
        this.storedId = value;
        if (value > 0) this.onGenerated?.(value);
    }
}

class AcceptanceChild {
    public id = '';
    public parentId = 0;
    public parent: AcceptanceParent | null = null;
}

class AcceptanceVersionRow {
    private storedVersion = 1;
    public id = '';
    public label = '';
    public failIncrement = false;
    public incrementFailure: unknown = new Error(
        'acceptance version setter failed',
    );
    public restorationFailure?: Error;
    public ignoreRestoration = false;
    public onVersionWrite?: (value: number) => void;
    public get version(): number {
        return this.storedVersion;
    }
    public set version(value: number) {
        if (value === 1 && this.ignoreRestoration) return;
        if (value === 1 && this.restorationFailure) {
            throw this.restorationFailure;
        }
        const previous = this.storedVersion;
        this.storedVersion = value;
        this.onVersionWrite?.(value);
        if (this.failIncrement && value > previous) {
            throw this.incrementFailure;
        }
    }
}

class AcceptanceFailureContext extends DbContext {
    public parents = this.set(AcceptanceParent);
    public children = this.set(AcceptanceChild);
    public versions = this.set(AcceptanceVersionRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(AcceptanceParent, entity => {
            entity.toTable('acceptance_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().useSqliteRowId();
            entity.property(row => row.name).hasColumnType('text').isRequired();
        });
        model.entity(AcceptanceChild, entity => {
            entity.toTable('acceptance_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('integer').isRequired();
            entity.hasOne(AcceptanceParent, row => row.parent)
                .withMany(row => row.children)
                .hasForeignKey(row => row.parentId);
        });
        model.entity(AcceptanceVersionRow, entity => {
            entity.toTable('acceptance_versions');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired();
            entity.property(row => row.version).hasColumnType('integer')
                .isRequired().isVersion();
        });
    }
}

async function open(): Promise<AcceptanceFailureContext> {
    const db = AcceptanceFailureContext.create();
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: `insert into acceptance_parents (id, name)
            values (?, ?), (?, ?)`,
        values: [0, 'zero', 2, 'existing'],
    });
    await db.database.connection.query({
        text: `insert into acceptance_children (id, parent_id)
            values (?, ?)`,
        values: ['existing-child', 2],
    });
    await db.database.connection.query({
        text: `insert into acceptance_versions (id, label, version)
            values (?, ?, ?)`,
        values: ['version', 'before', 1],
    });
    return db;
}

describe('generated identity acceptance failure', () => {
    it('captures an observed FK before generated acceptance rolls back', async () => {
        const db = await open();
        const child = await db.children.find('existing-child');
        if (!child) throw new Error('Expected existing child.');
        const parent = Object.assign(new AcceptanceParent(), {
            name: 'generated',
            onGenerated: (value: number) => {
                child.parentId = value;
            },
        });
        db.parents.add(parent);
        const version = await db.versions.find('version');
        if (!version) throw new Error('Expected version row.');
        version.label = 'after';
        version.failIncrement = true;

        await expect(db.saveChanges()).rejects.toThrow(
            'acceptance version setter failed',
        );
        expect(parent.id).toBe(0);
        expect(child.parentId).toBe(3);
        expect(db.entry(parent)?.state).toBe(EntityState.Added);
        await db.database.connection.query({
            text: 'insert into acceptance_parents (name) values (?)',
            values: ['unrelated'],
        });

        await expect(db.saveChanges()).rejects.toThrow(
            'has not been generated yet',
        );
        child.parentId = 2;
        version.failIncrement = false;
        await expect(db.saveChanges()).resolves.toBe(2);
        expect(parent.id).toBe(4);
        child.parent = parent;
        await expect(db.saveChanges()).resolves.toBe(1);
        expect(child.parentId).toBe(4);
        await db.dispose();
    });

    it.each(['throw', 'ignore'] as const)(
        'poisons contradictory version state when rollback must %s',
        async restorationMode => {
            const db = await open();
            const version = await db.versions.find('version');
            if (!version) throw new Error('Expected version row.');
            const restoration = new Error('version restoration failed');
            version.label = 'after';
            version.failIncrement = true;
            version.incrementFailure = null;
            if (restorationMode === 'throw') {
                version.restorationFailure = restoration;
            } else {
                version.ignoreRestoration = true;
            }

            let rejected = false;
            let primary: unknown;
            try {
                await db.saveChanges();
            } catch (error) {
                rejected = true;
                primary = error;
            }
            expect(rejected).toBe(true);
            expect(primary).toBeNull();
            expect(version.version).toBe(2);
            expect(db.entry(version)?.originalValues.version).toBe(1);

            let unusable: unknown;
            try {
                await db.versions.count();
            } catch (error) {
                unusable = error;
            }
            expect(unusable).toBeInstanceOf(ContextStateRestorationError);
            if (restorationMode === 'throw') {
                expect(unusable).toMatchObject({ cause: restoration });
            } else {
                expect((unusable as Error).cause).toMatchObject({
                    message: 'Property \'AcceptanceVersionRow.version\' refused its restoration value.',
                });
            }
            const next = Object.assign(new AcceptanceVersionRow(), { id: 'next' });
            expect(() => db.versions.add(next)).toThrow(unusable as Error);
            expect(() => db.versions.attach(next)).toThrow(unusable as Error);
            expect(() => {
                db.changeTracker.clear();
            }).toThrow(unusable as Error);
            expect(() => db.getSavePlan()).toThrow(unusable as Error);
            await expect(db.transaction(() => undefined)).rejects.toBe(unusable);
        },
    );

    it('restores captured versions and live accessors in reverse order', async () => {
        const db = await open();
        const rows = ['a', 'b', 'c'].map(id => Object.assign(
            new AcceptanceVersionRow(), { id, label: 'before' },
        ));
        for (const row of rows) {
            db.versions.attach(row);
            row.label = 'after';
        }
        const plan = db.getSavePlan();
        const order: string[] = [];
        for (const row of rows) {
            row.onVersionWrite = value => {
                if (value === 1) order.push(row.id);
            };
        }
        const primary = new Error('later version increment failed');
        rows[2].failIncrement = true;
        rows[2].incrementFailure = primary;
        const scope = new RestorationScope(() => undefined);

        expect(() => acceptVersionIncrements(plan, scope)).toThrow(primary);
        expect(order).toEqual(['c', 'b', 'a']);
        const persisted = plan.flatMap(item =>
            savePlanExecution(item)?.persistedEntries ?? []);
        expect(persisted.map(snapshot => snapshot.values.version))
            .toEqual([1, 1, 1]);
        expect(persisted.map(snapshot => snapshot.boundValues.version))
            .toEqual([1, 1, 1]);
        await db.dispose();
    });

    it('does not overwrite a live version changed after plan capture', async () => {
        const db = await open();
        const row = Object.assign(new AcceptanceVersionRow(), {
            id: 'external', label: 'before',
        });
        db.versions.attach(row);
        row.label = 'after';
        const plan = db.getSavePlan();
        row.version = 9;
        const scope = new RestorationScope(() => undefined);

        const rollback = acceptVersionIncrements(plan, scope);
        expect(row.version).toBe(9);
        rollback();
        expect(row.version).toBe(9);
        const persisted = savePlanExecution(plan[0])?.persistedEntries?.[0];
        expect(persisted?.values.version).toBe(1);
        expect(persisted?.boundValues.version).toBe(1);
        await db.dispose();
    });

    it('runs a successful version rollback in reverse write order', async () => {
        const db = await open();
        const rows = ['a', 'b', 'c'].map(id => Object.assign(
            new AcceptanceVersionRow(), { id, label: 'before' },
        ));
        for (const row of rows) {
            db.versions.attach(row);
            row.label = 'after';
        }
        const order: string[] = [];
        for (const row of rows) {
            row.onVersionWrite = value => {
                if (value === 1) order.push(row.id);
            };
        }
        const rollback = acceptVersionIncrements(
            db.getSavePlan(),
            new RestorationScope(() => undefined),
        );

        expect(rows.map(row => row.version)).toEqual([2, 2, 2]);
        rollback();
        expect(order).toEqual(['c', 'b', 'a']);
        expect(rows.map(row => row.version)).toEqual([1, 1, 1]);
        await db.dispose();
    });
});

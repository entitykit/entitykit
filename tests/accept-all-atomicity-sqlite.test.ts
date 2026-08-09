import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, EntityState } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import { navigationSnapshot } from '../src/tracking/navigation-snapshot';
import {
    internalChangeTracker,
    internalEntityEntry,
    setMetadata,
} from './support/public-api-internals';

class UnstableAcceptRow {
    public name = '';
    public idReads = 0;

    public get id(): string {
        this.idReads += 1;
        return this.idReads <= 2 ? 'one' : 'two';
    }
}

class WrongRowContext extends DbContext {
    public rows = this.set(UnstableAcceptRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(UnstableAcceptRow, entity => {
            entity.toTable('unstable_accept_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
        });
    }
}

class AtomicValue {
    public id = '';
    public name = '';
}

class AtomicParent {
    public id = '';
    public children: AtomicChild[] = [];
}

class AtomicChild {
    public id = '';
    public parentId = '';
    public parent?: AtomicParent;
}

class ThrowingAcceptRow {
    public name = '';
    public idReads = 0;

    public get id(): string {
        this.idReads += 1;
        if (this.idReads >= 3) {
            throw new Error('accept getter failed');
        }
        return 'throwing';
    }
}

class AtomicAcceptanceContext extends DbContext {
    public values = this.set(AtomicValue);
    public parents = this.set(AtomicParent);
    public children = this.set(AtomicChild);
    public throwingRows = this.set(ThrowingAcceptRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(AtomicValue, entity => {
            entity.toTable('atomic_values');
            entity.hasKey(value => value.id);
            entity.property(value => value.id).hasColumnType('text').isRequired();
            entity.property(value => value.name).hasColumnType('text').isRequired();
        });
        model.entity(AtomicParent, entity => {
            entity.toTable('atomic_parents');
            entity.hasKey(parent => parent.id);
            entity.property(parent => parent.id).hasColumnType('text')
                .isRequired();
        });
        model.entity(AtomicChild, entity => {
            entity.toTable('atomic_children');
            entity.hasKey(child => child.id);
            entity.property(child => child.id).hasColumnType('text').isRequired();
            entity.property(child => child.parentId).hasColumnName('parent_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(AtomicParent, child => child.parent)
                .withMany(parent => parent.children)
                .hasForeignKey(child => child.parentId);
        });
        model.entity(ThrowingAcceptRow, entity => {
            entity.toTable('throwing_accept_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
        });
    }
}

describe('acceptAllChanges atomicity', () => {
    it('keeps identity and baseline on one capture so deletion cannot redirect', async () => {
        const db = WrongRowContext.create();
        await db.database.connection.query({
            text: db.database.createScript(),
            values: [],
        });
        await db.database.connection.query({
            text: 'insert into unstable_accept_rows (id, name) values (?, ?), (?, ?)',
            values: ['one', 'row one', 'two', 'row two'],
        });
        const row = Object.assign(new UnstableAcceptRow(), { name: 'local' });
        const entry = db.rows.attach(row);

        expect(() => {
            db.changeTracker.acceptAllChanges();
        }).not.toThrow();
        expect(entry.originalValues.id).toBe('one');
        expect(entry.state).toBe(EntityState.Modified);
        expect(internalChangeTracker(db.changeTracker).tryGetByIdentity(
            setMetadata(db.rows),
            'one',
        )).toBe(internalEntityEntry(entry));

        db.rows.remove(row);
        await expect(db.saveChanges()).rejects.toThrow(
            'Primary key changes are not supported for entity \'UnstableAcceptRow\'',
        );
        const remaining = await db.database.connection.query<{
            id: string;
        }>({
            text: 'select id from unstable_accept_rows order by id',
            values: [],
        });
        expect(remaining.rows).toEqual([{ id: 'one' }, { id: 'two' }]);
        await db.dispose();
    });

    it('restores baselines detachments identities and navigations on failure', () => {
        const db = AtomicAcceptanceContext.create();
        const value = Object.assign(new AtomicValue(), {
            id: 'value-one',
            name: 'before',
        });
        const valueEntry = db.values.attach(value);
        value.name = 'after';
        db.changeTracker.detectChanges();

        const child = Object.assign(new AtomicChild(), {
            id: 'child-one',
            parentId: 'parent-one',
        });
        const parent = Object.assign(new AtomicParent(), {
            id: 'parent-one',
            children: [child],
        });
        child.parent = parent;
        const parentEntry = db.parents.attach(parent);
        db.parents.remove(parent);
        parent.children = [];

        const throwing = Object.assign(new ThrowingAcceptRow(), {
            name: 'throwing',
        });
        db.throwingRows.attach(throwing);

        expect(() => {
            db.changeTracker.acceptAllChanges();
        }).toThrow('accept getter failed');

        expect(valueEntry.originalValues.name).toBe('before');
        expect(valueEntry.state).toBe(EntityState.Modified);
        expect(db.entry(parent)).toBe(parentEntry);
        expect(parentEntry.state).toBe(EntityState.Deleted);
        expect(internalChangeTracker(db.changeTracker).tryGetByIdentity(
            setMetadata(db.parents),
            'parent-one',
        )).toBe(internalEntityEntry(parentEntry));
        expect(navigationSnapshot(
            internalEntityEntry(parentEntry) as unknown as Parameters<
                typeof navigationSnapshot
            >[0],
            'children',
        )).toEqual({ known: true, value: [child] });
    });
});

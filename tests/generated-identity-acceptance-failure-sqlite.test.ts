import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, EntityState } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

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
    public get version(): number {
        return this.storedVersion;
    }
    public set version(value: number) {
        if (this.failIncrement && value > this.storedVersion) {
            throw new Error('acceptance version setter failed');
        }
        this.storedVersion = value;
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
});

import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, EntityState } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { requireDefined } from './support/require-defined';
import { refusalMessage, rejection } from './support/accessor-refusal-support';

let scalarWrites = 0;

class RefusedScalarRow {
    private storedName = 'default';
    public id = '';

    public get name(): string {
        return this.storedName;
    }

    public set name(value: string) {
        scalarWrites += 1;
        if (value === 'database') return;
        this.storedName = value;
    }
}

class RefusedScope {
    public region?: string | null;
}

class RefusedStamp {
    public code?: string | null;
}

class RefusedRootRow {
    private storedStamp: RefusedStamp | null = new RefusedStamp();
    public id = '';
    public scope: RefusedScope | null = null;

    public get stamp(): RefusedStamp | null {
        return this.storedStamp;
    }

    public set stamp(value: RefusedStamp | null) {
        if (value === null) return;
        this.storedStamp = value;
    }
}

class MaterializationRefusalContext extends DbContext {
    public scalars = this.set(RefusedScalarRow);
    public roots = this.set(RefusedRootRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(RefusedScalarRow, entity => {
            entity.toTable('refused_scalar_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
        });
        model.entity(RefusedRootRow, entity => {
            entity.toTable('refused_root_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.complexProperty(
                row => row.scope,
                { constructor: RefusedScope },
                scope => scope.property(value => value.region)
                    .hasColumnName('region').hasColumnType('text').isOptional(),
            );
            entity.complexProperty(
                row => row.stamp,
                { constructor: RefusedStamp },
                stamp => stamp.property(value => value.code)
                    .hasColumnName('code').hasColumnType('text').isOptional(),
            );
        });
    }
}

async function open(): Promise<MaterializationRefusalContext> {
    const db = MaterializationRefusalContext.create();
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: `insert into refused_scalar_rows (id, name)
            values (?, ?), (?, ?)`,
        values: ['a-accepted', 'fine', 'b-refused', 'database'],
    });
    await db.database.connection.query({
        text: 'insert into refused_root_rows (id, region, code) values (?, ?, ?)',
        values: ['root-1', 'eu', 'live'],
    });
    return db;
}

describe('accessor refusal during materialization', () => {
    beforeEach(() => {
        scalarWrites = 0;
    });

    it('fails a query whose mapped scalar setter keeps its previous value', async () => {
        const db = await open();

        const failure = await rejection(async () =>
            db.scalars.orderBy(row => row.id).toArray());

        expect(refusalMessage(failure)).toBe(
            'Property \'RefusedScalarRow.name\' refused its assigned value.',
        );
        expect((failure as Error).cause).toBeUndefined();
        const entries = db.changeTracker.entries();
        expect(entries.map(entry => entry.keyValue)).toEqual(['a-accepted']);
        expect(entries[0]?.originalValues).toEqual({
            id: 'a-accepted', name: 'fine',
        });
        expect(entries[0]?.state).toBe(EntityState.Unchanged);
        expect(scalarWrites).toBe(2);
        const survivor = requireDefined(await db.scalars.find('a-accepted'));
        expect(survivor.name).toBe('fine');
        await expect(db.scalars.count()).resolves.toBe(2);
        expect(() => {
            db.changeTracker.clear();
        }).not.toThrow();
        await db.dispose();
    });

    it('fails a reload whose complex root setter keeps an object for a null row', async () => {
        const db = await open();
        const row = requireDefined(await db.roots.find('root-1'));
        const scopeBefore = row.scope;
        const stampBefore = row.stamp;
        const entry = requireDefined(db.entry(row));
        await db.database.connection.query({
            text: 'update refused_root_rows set code = null where id = ?',
            values: ['root-1'],
        });

        const failure = await rejection(async () => entry.reload());

        expect(refusalMessage(failure)).toBe(
            'Property \'RefusedRootRow.stamp\' refused its assigned value.',
        );
        expect(row.stamp).toBe(stampBefore);
        expect(row.scope).toBe(scopeBefore);
        expect(entry.originalValues).toEqual({
            id: 'root-1', 'scope.region': 'eu', 'stamp.code': 'live',
        });
        expect(entry.state).toBe(EntityState.Unchanged);
        expect(entry.modifiedProperties()).toEqual([]);
        await expect(db.roots.count()).resolves.toBe(1);
        expect(() => {
            db.changeTracker.clear();
        }).not.toThrow();
        await db.dispose();
    });
});

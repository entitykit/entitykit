import { ModelBuilder as ModelBuilderImplementation } from '../src/model/model-builder';
import { requireDefined } from './support/require-defined';
import type { DbContextOptionsBuilder , ModelBuilder } from '../src';
import { DbContext } from '../src';
import { contextMigrations } from '../src/migrations/api';
import { sqliteProviderServices } from '../src/providers/sqlite';

class OrderLine {
    public orderId!: string;
    public lineNumber!: number;
    public sku!: string;
    public allocations?: Allocation[];

    constructor(data?: Partial<OrderLine>) {
        Object.assign(this, data);
    }
}

class Allocation {
    public id!: string;
    public orderId!: string;
    public lineNumber!: number;
    public quantity!: number;
    public line?: OrderLine;

    constructor(data?: Partial<Allocation>) {
        Object.assign(this, data);
    }
}

class WarehouseContext extends DbContext {
    public lines = this.set(OrderLine);
    public allocations = this.set(Allocation);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(OrderLine, entity => {
            entity.toTable('order_lines');
            entity.hasKey(line => [line.orderId, line.lineNumber]);
            entity.property(line => line.orderId).hasColumnName('order_id').hasColumnType('text').isRequired();
            entity.property(line => line.lineNumber).hasColumnName('line_number').hasColumnType('integer').isRequired();
            entity.property(line => line.sku).hasColumnName('sku').hasColumnType('text').isRequired();
        });

        model.entity(Allocation, entity => {
            entity.toTable('allocations');
            entity.hasKey(allocation => allocation.id);
            entity.property(allocation => allocation.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(allocation => allocation.orderId).hasColumnName('order_id').hasColumnType('text').isRequired();
            entity.property(allocation => allocation.lineNumber).hasColumnName('line_number').hasColumnType('integer').isRequired();
            entity.property(allocation => allocation.quantity).hasColumnName('quantity').hasColumnType('integer').isRequired();
            // The foreign key lists its properties in the principal's key order.
            entity.hasOne(OrderLine, allocation => allocation.line)
                .withMany(line => line.allocations)
                .hasForeignKey(allocation => [allocation.orderId, allocation.lineNumber]);
        });
    }
}

async function createDb(): Promise<WarehouseContext> {
    const db = WarehouseContext.create();
    await db.database.connection.query({ text: db.database.createScript(), values: [] });
    return db;
}

async function seed(db: WarehouseContext): Promise<void> {
    db.lines.add(new OrderLine({ orderId: 'ord_1', lineNumber: 1, sku: 'A' }));
    db.lines.add(new OrderLine({ orderId: 'ord_1', lineNumber: 2, sku: 'B' }));
    db.lines.add(new OrderLine({ orderId: 'ord_2', lineNumber: 1, sku: 'C' }));
    await db.saveChanges();

    db.allocations.add(new Allocation({ id: 'al_1', orderId: 'ord_1', lineNumber: 1, quantity: 3 }));
    db.allocations.add(new Allocation({ id: 'al_2', orderId: 'ord_1', lineNumber: 1, quantity: 4 }));
    db.allocations.add(new Allocation({ id: 'al_3', orderId: 'ord_1', lineNumber: 2, quantity: 5 }));
    db.allocations.add(new Allocation({ id: 'al_4', orderId: 'ord_2', lineNumber: 1, quantity: 6 }));
    await db.saveChanges();
    db.changeTracker.clear();
}

describe('multi-column foreign keys', () => {
    let db: WarehouseContext;

    beforeEach(async () => {
        db = await createDb();
        await seed(db);
    });

    afterEach(async () => {
        await db.dispose();
    });

    it('generates a multi-column foreign key constraint in principal key order', () => {
        const script = db.database.createScript();

        expect(script).toContain('foreign key ("order_id", "line_number")');
        expect(script).toContain('references "order_lines" ("order_id", "line_number")');
    });

    it('loads a many-to-one navigation across the whole key', async () => {
        const allocations = await db.allocations
            .orderBy(allocation => allocation.id)
            .include(allocation => allocation.line)
            .toArray();

        expect(allocations).toHaveLength(4);
        expect(requireDefined(allocations[0].line).sku).toBe('A');
        expect(requireDefined(allocations[2].line).sku).toBe('B');
        // Shares lineNumber 1 with al_1 but belongs to a different order.
        expect(requireDefined(allocations[3].line).sku).toBe('C');
    });

    it('does not match rows that share only one key part', async () => {
        const allocation = await db.allocations.where(a => a.id.eq('al_4')).include(a => a.line).firstOrNull();

        expect(requireDefined(requireDefined(allocation).line).orderId).toBe('ord_2');
        expect(requireDefined(requireDefined(allocation).line).lineNumber).toBe(1);
        expect(requireDefined(requireDefined(allocation).line).sku).toBe('C');
    });

    it('loads a one-to-many collection across the whole key', async () => {
        const lines = await db.lines
            .orderBy(line => line.orderId)
            .orderBy(line => line.lineNumber)
            .include(line => line.allocations)
            .toArray();

        expect(lines.map(line => requireDefined(line.allocations).map(allocation => allocation.id))).toEqual([
            ['al_1', 'al_2'],
            ['al_3'],
            ['al_4'],
        ]);
    });

    it('wires the inverse navigation on loaded dependents', async () => {
        const line = await db.lines.where(l => l.sku.eq('A')).include(l => l.allocations).firstOrNull();

        expect(requireDefined(line).allocations).toHaveLength(2);
        for (const allocation of requireDefined(requireDefined(line).allocations)) {
            expect(allocation.line).toBe(line);
        }
    });

    it('leaves the navigation null when no principal matches the whole key', async () => {
    // The composite foreign key constraint would reject this row, so it is
    // inserted with enforcement off to exercise the loader against dangling
    // data rather than the database's own checking.
        await db.database.connection.query({ text: 'pragma foreign_keys = off', values: [] });
        await db.database.connection.query({
            text: 'insert into "allocations" ("id", "order_id", "line_number", "quantity") values (?, ?, ?, ?)',
            values: ['al_orphan', 'ord_9', 9, 1],
        });
        await db.database.connection.query({ text: 'pragma foreign_keys = on', values: [] });
        db.changeTracker.clear();

        const orphan = await db.allocations.where(a => a.id.eq('al_orphan')).include(a => a.line).firstOrNull();
        expect(requireDefined(orphan).line).toBeNull();
    });

    it('includes every foreign key property in the model snapshot', () => {
        const snapshot = contextMigrations(db).createModelSnapshot();
        const allocation = snapshot.entities.find(entity => entity.entityName === 'Allocation');
        const relationship = requireDefined(allocation).relationships[0];

        expect(relationship.foreignKeyProperties).toEqual(['orderId', 'lineNumber']);
        // The legacy single-column field is omitted rather than holding a partial key.
        expect(relationship.foreignKeyProperty).toBeUndefined();
    });

    it('rejects a foreign key that lists a property twice', () => {
        const model = new ModelBuilderImplementation();
        expect(() => model.entity(Allocation, entity => {
            entity.toTable('allocations');
            entity.hasKey(allocation => allocation.id);
            entity.hasOne(OrderLine, allocation => allocation.line)
                .hasForeignKey(allocation => [allocation.orderId, allocation.orderId]);
        })).toThrow('lists property \'orderId\' more than once');
    });
});

describe('filtered includes across a multi-column foreign key', () => {
    let db: WarehouseContext;

    beforeEach(async () => {
        db = await createDb();
        await seed(db);
    });

    afterEach(async () => {
        await db.dispose();
    });

    it('applies take() per principal', async () => {
    // The windowed-batch optimization partitions by a single column, so a
    // multi-column key falls back to the per-principal path. It must still
    // apply the limit per parent rather than globally.
        const lines = await db.lines
            .orderBy(line => line.orderId)
            .orderBy(line => line.lineNumber)
            .include(line => line.allocations.orderBy(allocation => allocation.id).take(1))
            .toArray();

        expect(lines.map(line => requireDefined(line.allocations).map(a => a.id))).toEqual([
            ['al_1'],
            ['al_3'],
            ['al_4'],
        ]);
    });
});

describe('relation-existence filters across a multi-column foreign key', () => {
    let db: WarehouseContext;

    beforeEach(async () => {
        db = await createDb();
        await seed(db);
    });

    afterEach(async () => {
        await db.dispose();
    });

    it('filters parents by related rows on the whole key', async () => {
    // al_3 is the only allocation on ord_1/2.
        const lines = await db.lines
            .whereHas(line => line.allocations, allocation => allocation.id.eq('al_3'))
            .toArray();

        expect(lines.map(line => [line.orderId, line.lineNumber])).toEqual([['ord_1', 2]]);
    });

    it('filters dependents by their principal on the whole key', async () => {
        const allocations = await db.allocations
            .whereHas(allocation => allocation.line, line => line.sku.eq('C'))
            .toArray();

        // Only al_4 belongs to ord_2/1, whose sku is C.
        expect(allocations.map(allocation => allocation.id)).toEqual(['al_4']);
    });

    it('does not match a parent that shares only one key column', async () => {
    // ord_2/1 shares lineNumber 1 with ord_1/1, whose allocations are al_1/al_2.
        const lines = await db.lines
            .whereHas(line => line.allocations, allocation => allocation.id.eq('al_1'))
            .toArray();

        expect(lines.map(line => [line.orderId, line.lineNumber])).toEqual([['ord_1', 1]]);
    });

    it('excludes matches with whereDoesNotHave', async () => {
        const lines = await db.lines
            .whereDoesNotHave(line => line.allocations, allocation => allocation.id.eq('al_1'))
            .orderBy(line => line.orderId)
            .orderBy(line => line.lineNumber)
            .toArray();

        expect(lines.map(line => [line.orderId, line.lineNumber])).toEqual([['ord_1', 2], ['ord_2', 1]]);
    });
});

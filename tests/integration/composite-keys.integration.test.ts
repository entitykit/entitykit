import { requireDefined } from '../support/require-defined';
import type { DbContextOptionsBuilder, ModelBuilder } from '../../src';
import { DbContext } from '../../src';
import { postgresProviderServices } from '../../src/providers/postgres';

const shouldRunPostgresTests = process.env.RUN_POSTGRES_TESTS === 'true' && Boolean(process.env.DATABASE_URL);
const describePostgres = shouldRunPostgresTests ? describe : describe.skip;

class OrderLine {
    public orderId!: string;
    public lineNumber!: number;
    public sku!: string;
    public quantity!: number;

    constructor(data?: Partial<OrderLine>) {
        Object.assign(this, data);
    }
}

class OrderLineContext extends DbContext {
    public lines = this.set(OrderLine);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(postgresProviderServices, requireDefined(process.env.DATABASE_URL));
    }

    protected override model(model: ModelBuilder): void {
        model.entity(OrderLine, entity => {
            entity.toTable('composite_order_lines');
            entity.hasKey(line => [line.orderId, line.lineNumber]);
            entity.property(line => line.orderId).hasColumnName('order_id').hasColumnType('text').isRequired();
            entity.property(line => line.lineNumber).hasColumnName('line_number').hasColumnType('integer').isRequired();
            entity.property(line => line.sku).hasColumnName('sku').hasColumnType('text').isRequired();
            entity.property(line => line.quantity).hasColumnName('quantity').hasColumnType('integer').isRequired();
        });
    }
}

describePostgres('composite keys against live Postgres', () => {
    let db: OrderLineContext;

    beforeEach(async () => {
        db = OrderLineContext.create();
        await db.database.connection.query({ text: 'drop table if exists "composite_order_lines" cascade', values: [] });
        await db.database.connection.query({ text: db.database.createScript(), values: [] });

        db.lines.add(new OrderLine({ orderId: 'ord_1', lineNumber: 1, sku: 'A', quantity: 2 }));
        db.lines.add(new OrderLine({ orderId: 'ord_1', lineNumber: 2, sku: 'B', quantity: 5 }));
        db.lines.add(new OrderLine({ orderId: 'ord_2', lineNumber: 1, sku: 'C', quantity: 7 }));
        await db.saveChanges();
        db.changeTracker.clear();
    });

    afterEach(async () => {
        await db.database.connection.query({ text: 'drop table if exists "composite_order_lines" cascade', values: [] });
        await db.dispose();
    });

    it('creates a real composite primary key constraint', async () => {
        const constraint = await db.database.connection.query<{ definition: string }>({
            text: `select pg_get_constraintdef(c.oid) as definition
             from pg_constraint c
             join pg_class t on t.oid = c.conrelid
             where t.relname = 'composite_order_lines' and c.contype = 'p'`,
            values: [],
        });

        // Column order follows the key declaration order.
        expect(constraint.rows[0].definition).toBe('PRIMARY KEY (order_id, line_number)');
    });

    it('enforces uniqueness on the pair, not on either part', async () => {
    // Same order, new line number: allowed.
        db.lines.add(new OrderLine({ orderId: 'ord_1', lineNumber: 3, sku: 'D', quantity: 1 }));
        await expect(db.saveChanges()).resolves.toBe(1);

        // Duplicate pair: rejected by the database.
        await expect(db.database.connection.query({
            text: 'insert into "composite_order_lines" ("order_id", "line_number", "sku", "quantity") values ($1, $2, $3, $4)',
            values: ['ord_1', 3, 'E', 1],
        })).rejects.toThrow();
    });

    it('reads, updates, and deletes by the whole key', async () => {
        const line = await db.lines.find('ord_1', 2);
        expect(requireDefined(line).sku).toBe('B');

        requireDefined(line).quantity = 42;
        await expect(db.saveChanges()).resolves.toBe(1);

        db.changeTracker.clear();
        expect(requireDefined(await db.lines.find('ord_1', 2)).quantity).toBe(42);
        // The row sharing a key part is untouched.
        expect(requireDefined(await db.lines.find('ord_2', 1)).quantity).toBe(7);

        db.changeTracker.clear();
        const doomed = await db.lines.find('ord_2', 1);
        db.lines.remove(requireDefined(doomed));
        await expect(db.saveChanges()).resolves.toBe(1);

        db.changeTracker.clear();
        expect(await db.lines.find('ord_2', 1)).toBeNull();
        expect(await db.lines.count()).toBe(2);
    });
});

class Allocation {
    public id!: string;
    public orderId!: string;
    public lineNumber!: number;
    public line?: OrderLine;

    constructor(data?: Partial<Allocation>) {
        Object.assign(this, data);
    }
}

class AllocationContext extends DbContext {
    public lines = this.set(OrderLine);
    public allocations = this.set(Allocation);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(postgresProviderServices, requireDefined(process.env.DATABASE_URL));
    }

    protected override model(model: ModelBuilder): void {
        model.entity(OrderLine, entity => {
            entity.toTable('composite_order_lines');
            entity.hasKey(line => [line.orderId, line.lineNumber]);
            entity.property(line => line.orderId).hasColumnName('order_id').hasColumnType('text').isRequired();
            entity.property(line => line.lineNumber).hasColumnName('line_number').hasColumnType('integer').isRequired();
            entity.property(line => line.sku).hasColumnName('sku').hasColumnType('text').isRequired();
            entity.property(line => line.quantity).hasColumnName('quantity').hasColumnType('integer').isRequired();
        });

        model.entity(Allocation, entity => {
            entity.toTable('composite_allocations');
            entity.hasKey(allocation => allocation.id);
            entity.property(allocation => allocation.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(allocation => allocation.orderId).hasColumnName('order_id').hasColumnType('text').isRequired();
            entity.property(allocation => allocation.lineNumber).hasColumnName('line_number').hasColumnType('integer').isRequired();
            entity.hasOne(OrderLine, allocation => allocation.line)
                .hasForeignKey(allocation => [allocation.orderId, allocation.lineNumber]);
        });
    }
}

describePostgres('multi-column foreign keys against live Postgres', () => {
    let db: AllocationContext;

    beforeEach(async () => {
        db = AllocationContext.create();
        await db.database.connection.query({ text: 'drop table if exists "composite_allocations" cascade', values: [] });
        await db.database.connection.query({ text: 'drop table if exists "composite_order_lines" cascade', values: [] });
        await db.database.connection.query({ text: db.database.createScript(), values: [] });

        db.lines.add(new OrderLine({ orderId: 'ord_1', lineNumber: 1, sku: 'A', quantity: 1 }));
        db.lines.add(new OrderLine({ orderId: 'ord_2', lineNumber: 1, sku: 'C', quantity: 1 }));
        await db.saveChanges();
        db.allocations.add(new Allocation({ id: 'al_1', orderId: 'ord_2', lineNumber: 1 }));
        await db.saveChanges();
        db.changeTracker.clear();
    });

    afterEach(async () => {
        await db.database.connection.query({ text: 'drop table if exists "composite_allocations" cascade', values: [] });
        await db.database.connection.query({ text: 'drop table if exists "composite_order_lines" cascade', values: [] });
        await db.dispose();
    });

    it('creates a real multi-column foreign key constraint', async () => {
        const constraint = await db.database.connection.query<{ definition: string }>({
            text: `select pg_get_constraintdef(c.oid) as definition
             from pg_constraint c
             join pg_class t on t.oid = c.conrelid
             where t.relname = 'composite_allocations' and c.contype = 'f'`,
            values: [],
        });

        expect(constraint.rows[0].definition).toContain('FOREIGN KEY (order_id, line_number)');
        expect(constraint.rows[0].definition).toContain('REFERENCES composite_order_lines(order_id, line_number)');
    });

    it('is enforced by the database on the whole key', async () => {
    // ord_1/lineNumber 9 does not exist even though ord_1 does.
        await expect(db.database.connection.query({
            text: 'insert into "composite_allocations" ("id", "order_id", "line_number") values ($1, $2, $3)',
            values: ['al_bad', 'ord_1', 9],
        })).rejects.toThrow();
    });

    it('loads the navigation matching on all key columns', async () => {
        const allocation = await db.allocations.include(item => item.line).firstOrNull();

        expect(requireDefined(requireDefined(allocation).line).orderId).toBe('ord_2');
        expect(requireDefined(requireDefined(allocation).line).sku).toBe('C');
    });
});

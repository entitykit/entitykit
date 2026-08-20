import { requireDefined } from '../support/require-defined';
import type { DbContextOptionsBuilder, ModelBuilder } from '../../packages/core/src';
import { DbContext } from '../../packages/core/src';
import { contextMigrations, diffModelSnapshots } from '../../packages/core/src/migrations/api';
import { postgresProviderServices } from '../../packages/postgres/src';

const shouldRunPostgresTests = process.env.RUN_POSTGRES_TESTS === 'true' && Boolean(process.env.DATABASE_URL);
const describePostgres = shouldRunPostgresTests ? describe : describe.skip;

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
    public line?: OrderLine;

    constructor(data?: Partial<Allocation>) {
        Object.assign(this, data);
    }
}

class WarehouseContext extends DbContext {
    public lines = this.set(OrderLine);
    public allocations = this.set(Allocation);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(postgresProviderServices, requireDefined(process.env.DATABASE_URL));
    }

    protected override model(model: ModelBuilder): void {
        model.entity(OrderLine, entity => {
            entity.toTable('migrated_order_lines');
            entity.hasKey(line => [line.orderId, line.lineNumber]);
            entity.property(line => line.orderId).hasColumnName('order_id').hasColumnType('text').isRequired();
            entity.property(line => line.lineNumber).hasColumnName('line_number').hasColumnType('integer').isRequired();
            entity.property(line => line.sku).hasColumnName('sku').hasColumnType('text').isRequired();
        });

        model.entity(Allocation, entity => {
            entity.toTable('migrated_allocations');
            entity.hasKey(allocation => allocation.id);
            entity.property(allocation => allocation.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(allocation => allocation.orderId).hasColumnName('order_id').hasColumnType('text').isRequired();
            entity.property(allocation => allocation.lineNumber).hasColumnName('line_number').hasColumnType('integer').isRequired();
            entity.hasOne(OrderLine, allocation => allocation.line)
                .withMany(line => line.allocations)
                .hasForeignKey(allocation => [allocation.orderId, allocation.lineNumber]);
        });
    }
}

describePostgres('composite-key migrations against live Postgres', () => {
    let db: WarehouseContext;

    beforeEach(async () => {
        db = WarehouseContext.create();
        await db.database.connection.query({ text: 'drop table if exists "migrated_allocations" cascade', values: [] });
        await db.database.connection.query({ text: 'drop table if exists "migrated_order_lines" cascade', values: [] });
        // Migration history persists across tests otherwise, so re-applying the
        // same migration id would collide.
        await db.database.connection.query({ text: 'drop table if exists "__entitykit_migrations" cascade', values: [] });
    });

    afterEach(async () => {
        await db.database.connection.query({ text: 'drop table if exists "migrated_allocations" cascade', values: [] });
        await db.database.connection.query({ text: 'drop table if exists "migrated_order_lines" cascade', values: [] });
        await db.dispose();
    });

    it('applies a generated migration producing both constraints', async () => {
        const migration = diffModelSnapshots({ formatVersion: 1, entities: [] }, contextMigrations(db).createModelSnapshot())
            .toMigration('20260101000000_CreateWarehouse', 'CreateWarehouse');

        await contextMigrations(db).apply(migration);

        const primaryKey = await db.database.connection.query<{ definition: string }>({
            text: `select pg_get_constraintdef(c.oid) as definition
             from pg_constraint c join pg_class t on t.oid = c.conrelid
             where t.relname = 'migrated_order_lines' and c.contype = 'p'`,
            values: [],
        });
        expect(primaryKey.rows[0].definition).toBe('PRIMARY KEY (order_id, line_number)');

        const foreignKey = await db.database.connection.query<{ definition: string }>({
            text: `select pg_get_constraintdef(c.oid) as definition
             from pg_constraint c join pg_class t on t.oid = c.conrelid
             where t.relname = 'migrated_allocations' and c.contype = 'f'`,
            values: [],
        });
        expect(foreignKey.rows[0].definition).toContain('FOREIGN KEY (order_id, line_number)');
        expect(foreignKey.rows[0].definition).toContain('REFERENCES migrated_order_lines(order_id, line_number)');
    });

    it('produces a schema the database enforces on both key columns', async () => {
        const migration = diffModelSnapshots({ formatVersion: 1, entities: [] }, contextMigrations(db).createModelSnapshot())
            .toMigration('20260101000000_CreateWarehouse', 'CreateWarehouse');
        await contextMigrations(db).apply(migration);

        db.lines.add(new OrderLine({ orderId: 'ord_1', lineNumber: 1, sku: 'A' }));
        db.lines.add(new OrderLine({ orderId: 'ord_1', lineNumber: 2, sku: 'B' }));
        await db.saveChanges();

        // Duplicate key pair is rejected.
        await expect(db.database.connection.query({
            text: 'insert into "migrated_order_lines" ("order_id", "line_number", "sku") values ($1, $2, $3)',
            values: ['ord_1', 1, 'C'],
        })).rejects.toThrow();

        // Foreign key matching only one column is rejected.
        await expect(db.database.connection.query({
            text: 'insert into "migrated_allocations" ("id", "order_id", "line_number") values ($1, $2, $3)',
            values: ['al_bad', 'ord_1', 9],
        })).rejects.toThrow();

        db.allocations.add(new Allocation({ id: 'al_1', orderId: 'ord_1', lineNumber: 2 }));
        await expect(db.saveChanges()).resolves.toBe(1);
    });

    it('reports no pending changes after the migration is applied', () => {
        const snapshot = contextMigrations(db).createModelSnapshot();

        expect(diffModelSnapshots(snapshot, snapshot).hasChanges).toBe(false);
    });
});

import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext } from '../src';
import { contextMigrations, MigrationBuilder, diffModelSnapshots } from '../src/migrations/api';
import { sqliteDialect, sqliteProviderServices } from '../src/providers/sqlite';
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
            entity.hasOne(OrderLine, allocation => allocation.line)
                .withMany(line => line.allocations)
                .hasForeignKey(allocation => [allocation.orderId, allocation.lineNumber]);
        });
    }
}

const emptySnapshot = { formatVersion: 1 as const, entities: [] };

function createContext(): WarehouseContext {
    const db = WarehouseContext.create();
    return db;
}

describe('MigrationBuilder composite primary keys', () => {
    it('renders a table-level constraint when several columns are keys', () => {
        const builder = new MigrationBuilder(sqliteDialect);
        builder.createTable('order_lines', [
            { name: 'order_id', type: 'text', primaryKey: true },
            { name: 'line_number', type: 'integer', primaryKey: true },
            { name: 'sku', type: 'text' },
        ]);

        expect(builder.statements[0].text).toBe(
            'create table if not exists "order_lines" ("order_id" text not null, "line_number" integer not null, "sku" text not null, primary key ("order_id", "line_number"))',
        );
    });

    it('keeps the inline form for a single key column', () => {
        const builder = new MigrationBuilder(sqliteDialect);
        builder.createTable('allocations', [
            { name: 'id', type: 'text', primaryKey: true },
            { name: 'sku', type: 'text' },
        ]);

        expect(builder.statements[0].text).toBe(
            'create table if not exists "allocations" ("id" text primary key, "sku" text not null)',
        );
    });

    it('renders a named primary key inline with table creation', () => {
        const builder = new MigrationBuilder(sqliteDialect);
        builder.createTable('order_lines', [
            { name: 'order_id', type: 'text', primaryKey: true },
            { name: 'line_number', type: 'integer', primaryKey: true },
        ], undefined, { primaryKeyName: 'pk_order_lines_custom' });

        expect(builder.statements[0].text).toContain(
            'constraint "pk_order_lines_custom" primary key ("order_id", "line_number")',
        );
    });

    it('rejects a primary-key name without primary-key columns', () => {
        const builder = new MigrationBuilder(sqliteDialect);

        expect(() => builder.createTable('logs', [
            { name: 'message', type: 'text' },
        ], undefined, { primaryKeyName: 'pk_logs' })).toThrow(
            'primaryKeyName requires at least one primary-key column',
        );
    });
});

describe('migration diffs for composite keys', () => {
    it('emits create-table operations carrying every key column', () => {
        const db = createContext();
        const diff = diffModelSnapshots(
            emptySnapshot,
            contextMigrations(db).createModelSnapshot(),
        );

        const createLines = diff.operations.find(
            operation => operation.kind === 'createTable' && operation.entityName === 'OrderLine',
        );
        expect(createLines).toBeDefined();
        const keyColumns = (createLines as { columns: ReadonlyArray<{ name: string; primaryKey?: boolean }> }).columns
            .filter(column => column.primaryKey)
            .map(column => column.name);
        expect(keyColumns).toEqual(['order_id', 'line_number']);
    });

    it('emits a foreign key operation carrying every column in principal key order', () => {
        const db = createContext();
        const diff = diffModelSnapshots(
            emptySnapshot,
            contextMigrations(db).createModelSnapshot(),
        );

        const addForeignKey = diff.operations.find(operation => operation.kind === 'addForeignKey');
        expect(addForeignKey).toMatchObject({
            columns: ['order_id', 'line_number'],
            principalColumns: ['order_id', 'line_number'],
        });
    });

    it('reports no changes when the model is unchanged', () => {
        const db = createContext();
        const snapshot = contextMigrations(db).createModelSnapshot();

        expect(diffModelSnapshots(snapshot, snapshot).hasChanges).toBe(false);
    });
});

describe('generated composite-key migrations run against SQLite', () => {
    it('applies a migration whose table-level primary key the database enforces', async () => {
        const db = createContext();
        const migration = diffModelSnapshots(
            emptySnapshot,
            contextMigrations(db).createModelSnapshot(),
        )
            .toMigration('20260101000000_CreateWarehouse', 'CreateWarehouse');

        await contextMigrations(db).apply(migration);

        // The composite primary key is enforced by the database.
        await db.database.connection.query({
            text: 'insert into "order_lines" ("order_id", "line_number", "sku") values (?, ?, ?)',
            values: ['ord_1', 1, 'A'],
        });
        await expect(db.database.connection.query({
            text: 'insert into "order_lines" ("order_id", "line_number", "sku") values (?, ?, ?)',
            values: ['ord_1', 1, 'B'],
        })).rejects.toThrow();

        // A different line number under the same order is a distinct row.
        await db.database.connection.query({
            text: 'insert into "order_lines" ("order_id", "line_number", "sku") values (?, ?, ?)',
            values: ['ord_1', 2, 'B'],
        });

        const rows = await db.database.connection.query<{ count: number }>({
            text: 'select count(*) as "count" from "order_lines"',
            values: [],
        });
        expect(rows.rows[0].count).toBe(2);

        await db.dispose();
    });
});

describe('SQLite migrations with relationships', () => {
    it('declares foreign keys inline so the database enforces them', async () => {
        const db = createContext();
        const migration = diffModelSnapshots(
            emptySnapshot,
            contextMigrations(db).createModelSnapshot(),
        )
            .toMigration('20260101000000_CreateWarehouse', 'CreateWarehouse');
        await contextMigrations(db).apply(migration);

        await db.database.connection.query({
            text: 'insert into "order_lines" ("order_id", "line_number", "sku") values (?, ?, ?)',
            values: ['ord_1', 1, 'A'],
        });

        // Matches only one key column, so the composite foreign key rejects it.
        await expect(db.database.connection.query({
            text: 'insert into "allocations" ("id", "order_id", "line_number") values (?, ?, ?)',
            values: ['al_bad', 'ord_1', 9],
        })).rejects.toThrow();

        await db.database.connection.query({
            text: 'insert into "allocations" ("id", "order_id", "line_number") values (?, ?, ?)',
            values: ['al_1', 'ord_1', 1],
        });
        const rows = await db.database.connection.query<{ count: number }>({
            text: 'select count(*) as "count" from "allocations"',
            values: [],
        });
        expect(rows.rows[0].count).toBe(1);

        await db.dispose();
    });

    it('rolls the migration back by dropping the tables', async () => {
        const db = createContext();
        const migration = diffModelSnapshots(
            emptySnapshot,
            contextMigrations(db).createModelSnapshot(),
        )
            .toMigration('20260101000000_CreateWarehouse', 'CreateWarehouse');
        await contextMigrations(db).apply(migration);
        await contextMigrations(db).revert(migration);

        // Dropping the table removes its inline constraint, so no separate
        // drop-constraint statement is needed — which SQLite could not run anyway.
        await expect(db.database.connection.query({ text: 'select 1 from "allocations"', values: [] })).rejects.toThrow();

        await db.dispose();
    });

    it('still reports a foreign key added to a table it did not create', () => {
        const builder = sqliteProviderServices.createMigrationBuilder();

        // Nothing to fold it into, so the provider limitation stands.
        expect(() => builder.addForeignKey({
            name: 'fk_late',
            tableName: 'existing_table',
            columns: ['other_id'],
            principalTableName: 'others',
            principalColumns: ['id'],
        })).toThrow('not supported by provider \'sqlite\'');
    });
});

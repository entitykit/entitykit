import { ModelBuilder as ModelBuilderImplementation } from '../src/model/model-builder';
import { requireDefined } from './support/require-defined';
import type { DbContextOptionsBuilder , ModelBuilder } from '../src';
import { DbContext, EntityState } from '../src';
import { contextMigrations } from '../src/migrations/api';
import { sqliteProviderServices } from '../src/providers/sqlite';

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
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(OrderLine, entity => {
            entity.toTable('order_lines');
            // Declaration order is significant: it sets the primary key column order
            // and the order find() takes its values.
            entity.hasKey(line => [line.orderId, line.lineNumber]);
            entity.property(line => line.orderId).hasColumnName('order_id').hasColumnType('text').isRequired();
            entity.property(line => line.lineNumber).hasColumnName('line_number').hasColumnType('integer').isRequired();
            entity.property(line => line.sku).hasColumnName('sku').hasColumnType('text').isRequired();
            entity.property(line => line.quantity).hasColumnName('quantity').hasColumnType('integer').isRequired();
        });
    }
}

async function createDb(): Promise<OrderLineContext> {
    const db = OrderLineContext.create();
    await db.database.connection.query({ text: db.database.createScript(), values: [] });
    return db;
}

async function seed(db: OrderLineContext): Promise<void> {
    db.lines.add(new OrderLine({ orderId: 'ord_1', lineNumber: 1, sku: 'A', quantity: 2 }));
    db.lines.add(new OrderLine({ orderId: 'ord_1', lineNumber: 2, sku: 'B', quantity: 5 }));
    // Same line number under a different order: only the pair is unique.
    db.lines.add(new OrderLine({ orderId: 'ord_2', lineNumber: 1, sku: 'C', quantity: 7 }));
    await db.saveChanges();
    db.changeTracker.clear();
}

describe('composite keys', () => {
    let db: OrderLineContext;

    beforeEach(async () => {
        db = await createDb();
        await seed(db);
    });

    afterEach(async () => {
        await db.dispose();
    });

    it('generates a table-level primary key constraint in declaration order', () => {
        expect(db.database.createScript()).toContain('primary key ("order_id", "line_number")');
        // The inline single-column form must not also appear.
        expect(db.database.createScript()).not.toMatch(/"order_id" text primary key/);
    });

    it('finds an entity by all key values in declaration order', async () => {
        const line = await db.lines.find('ord_1', 2);

        expect(line).not.toBeNull();
        expect(requireDefined(line).sku).toBe('B');
        expect(requireDefined(line).quantity).toBe(5);
    });

    it('distinguishes rows that share one key part', async () => {
        const first = await db.lines.find('ord_1', 1);
        const second = await db.lines.find('ord_2', 1);

        expect(requireDefined(first).sku).toBe('A');
        expect(requireDefined(second).sku).toBe('C');
        expect(first).not.toBe(second);
    });

    it('rejects the wrong number of key values', async () => {
        await expect(db.lines.find('ord_1')).rejects.toThrow(
            'find() on \'OrderLine\' expects 2 key values (orderId, lineNumber), but received 1',
        );
        await expect(db.lines.find('ord_1', 1, 'extra')).rejects.toThrow('but received 3');
    });

    it('keeps one tracked instance per key tuple', async () => {
        const first = await db.lines.find('ord_1', 1);
        const again = await db.lines.find('ord_1', 1);

        expect(first).toBe(again);
        expect(db.changeTracker.entries()).toHaveLength(1);
    });

    it('does not confuse key tuples whose parts concatenate alike', async () => {
    // "a|b" + "c" and "a" + "b|c" must not collide in the identity map.
        db.lines.add(new OrderLine({ orderId: 'a|b', lineNumber: 1, sku: 'X', quantity: 1 }));
        db.lines.add(new OrderLine({ orderId: 'a', lineNumber: 2, sku: 'Y', quantity: 1 }));
        await db.saveChanges();

        expect(db.changeTracker.entries().filter(entry => entry.state === EntityState.Unchanged)).toHaveLength(2);

        db.changeTracker.clear();
        const left = await db.lines.find('a|b', 1);
        const right = await db.lines.find('a', 2);
        expect(requireDefined(left).sku).toBe('X');
        expect(requireDefined(right).sku).toBe('Y');
    });

    it('updates the row matching the whole key', async () => {
        const line = await db.lines.find('ord_1', 2);
        requireDefined(line).quantity = 99;
        await expect(db.saveChanges()).resolves.toBe(1);

        db.changeTracker.clear();
        expect(requireDefined(await db.lines.find('ord_1', 2)).quantity).toBe(99);
        // The row sharing a key part must be untouched.
        expect(requireDefined(await db.lines.find('ord_2', 1)).quantity).toBe(7);
    });

    it('deletes the row matching the whole key', async () => {
        const line = await db.lines.find('ord_1', 1);
        db.lines.remove(requireDefined(line));
        await expect(db.saveChanges()).resolves.toBe(1);

        db.changeTracker.clear();
        expect(await db.lines.find('ord_1', 1)).toBeNull();
        expect(await db.lines.find('ord_2', 1)).not.toBeNull();
        expect(await db.lines.count()).toBe(2);
    });

    it('refuses to change any part of the key', async () => {
        const line = await db.lines.find('ord_1', 1);
        requireDefined(line).lineNumber = 42;

        await expect(db.saveChanges()).rejects.toThrow(
            'Primary key changes are not supported for entity \'OrderLine\' (property \'lineNumber\')',
        );
    });

    it('reports a duplicate key property instead of accepting it', () => {
        const model = new ModelBuilderImplementation();
        expect(() => model.entity(OrderLine, entity => {
            entity.toTable('order_lines');
            entity.hasKey(line => [line.orderId, line.orderId]);
        })).toThrow('lists property \'orderId\' more than once');
    });

    it('includes every key property in the model snapshot', () => {
        const snapshot = contextMigrations(db).createModelSnapshot();
        const entity = snapshot.entities.find(item => item.entityName === 'OrderLine');

        expect(requireDefined(entity).keyProperties).toEqual(['orderId', 'lineNumber']);
        // The legacy single-key field is omitted rather than holding a partial key.
        expect(requireDefined(entity).keyProperty).toBeUndefined();
        expect(requireDefined(entity).properties.filter(property => property.isPrimaryKey).map(property => property.propertyName))
            .toEqual(['orderId', 'lineNumber']);
    });
});

describe('foreign key arity against a composite key', () => {
    class Parent {
        public aId!: string;
        public bId!: string;
        public children?: Child[];

        constructor(data?: Partial<Parent>) {
            Object.assign(this, data);
        }
    }

    class Child {
        public id!: string;
        public parentAId!: string;
        public parent?: Parent;

        constructor(data?: Partial<Child>) {
            Object.assign(this, data);
        }
    }

    class RelationshipContext extends DbContext {
        public parents = this.set(Parent);
        public children = this.set(Child);

        protected override configure(options: DbContextOptionsBuilder): void {
            options.useProvider(sqliteProviderServices, ':memory:');
        }

        protected override model(model: ModelBuilder): void {
            model.entity(Parent, entity => {
                entity.toTable('parents');
                entity.hasKey(parent => [parent.aId, parent.bId]);
                entity.property(parent => parent.aId).hasColumnName('a_id').hasColumnType('text').isRequired();
                entity.property(parent => parent.bId).hasColumnName('b_id').hasColumnType('text').isRequired();
            });

            model.entity(Child, entity => {
                entity.toTable('children');
                entity.hasKey(child => child.id);
                entity.property(child => child.id).hasColumnName('id').hasColumnType('text').isRequired();
                entity.property(child => child.parentAId).hasColumnName('parent_a_id').hasColumnType('text').isRequired();
                entity.hasOne(Parent, child => child.parent).withMany(parent => parent.children)
                    .hasForeignKey(child => child.parentAId);
            });
        }
    }

    it('reports a foreign key that does not cover the whole principal key', () => {
        // A single-column foreign key cannot reference a two-column key, so this
        // must be reported rather than emitting SQL for a partial key.
        expect(() => RelationshipContext.create()).toThrow(
            'Relationship \'parent\' on entity \'Child\' declares 1 foreign-key property, but its principal key has 2 properties.',
        );
    });
});

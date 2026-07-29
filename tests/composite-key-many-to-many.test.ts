import { ModelBuilder as ModelBuilderImplementation } from '../src/model/model-builder';
import { requireDefined } from './support/require-defined';
import type { DbContextOptionsBuilder , ModelBuilder } from '../src';
import { DbContext } from '../src';
import { contextMigrations, diffModelSnapshots } from '../src/migrations/api';
import { sqliteProviderServices } from '../src/providers/sqlite';

class OrderLine {
    public orderId!: string;
    public lineNumber!: number;
    public sku!: string;
    public tags?: Tag[];

    constructor(data?: Partial<OrderLine>) {
        Object.assign(this, data);
    }
}

class Tag {
    public id!: string;
    public name!: string;
    public lines?: OrderLine[];

    constructor(data?: Partial<Tag>) {
        Object.assign(this, data);
    }
}

class CatalogContext extends DbContext {
    public lines = this.set(OrderLine);
    public tags = this.set(Tag);

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
            entity.hasManyToMany(Tag, line => line.tags)
                .withMany(tag => tag.lines)
                .usingJoinTable('order_line_tags', join => {
                    // One join column per key column, in the entity's key order.
                    join.primaryKeyName('pk_order_line_tags_custom');
                    join.sourceForeignKey(['order_id', 'line_number']);
                    join.targetForeignKey('tag_id');
                });
        });

        model.entity(Tag, entity => {
            entity.toTable('tags');
            entity.hasKey(tag => tag.id);
            entity.property(tag => tag.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(tag => tag.name).hasColumnName('name').hasColumnType('text').isRequired();
        });
    }
}

async function createDb(): Promise<CatalogContext> {
    const db = CatalogContext.create();
    await db.database.connection.query({ text: db.database.createScript(), values: [] });
    return db;
}

async function seed(db: CatalogContext): Promise<void> {
    db.lines.add(new OrderLine({ orderId: 'ord_1', lineNumber: 1, sku: 'A' }));
    db.lines.add(new OrderLine({ orderId: 'ord_1', lineNumber: 2, sku: 'B' }));
    // Shares a line number with ord_1/1 but is a different row.
    db.lines.add(new OrderLine({ orderId: 'ord_2', lineNumber: 1, sku: 'C' }));
    db.tags.add(new Tag({ id: 'tag_new', name: 'new' }));
    db.tags.add(new Tag({ id: 'tag_hot', name: 'hot' }));
    await db.saveChanges();
}

describe('many-to-many with a composite-keyed side', () => {
    let db: CatalogContext;

    beforeEach(async () => {
        db = await createDb();
        await seed(db);
    });

    afterEach(async () => {
        await db.dispose();
    });

    it('generates a join table with one column per key column', () => {
        const script = db.database.createScript();

        expect(script).toContain('primary key ("order_id", "line_number", "tag_id")');
        expect(script).toContain(
            'constraint "pk_order_line_tags_custom" primary key',
        );
        expect(script).toContain('foreign key ("order_id", "line_number")');
        expect(script).toContain('references "order_lines" ("order_id", "line_number")');
        expect(script).toContain('foreign key ("tag_id")');
    });

    it('creates the composite join through a reversible SQLite migration', async () => {
        const migrated = CatalogContext.create();
        const empty = { formatVersion: 1 as const, entities: [] };
        const diff = diffModelSnapshots(
            empty,
            contextMigrations(migrated).createModelSnapshot(),
        );
        const join = diff.operations.find(
            operation => operation.kind === 'createJoinTable',
        );
        expect(join).toMatchObject({
            sourceColumnNames: ['order_id', 'line_number'],
            sourceForeignKeyColumns: ['order_id', 'line_number'],
            targetColumnNames: ['id'],
            targetForeignKeyColumns: ['tag_id'],
            primaryKeyName: 'pk_order_line_tags_custom',
            primaryKeyColumns: ['order_id', 'line_number', 'tag_id'],
        });

        await contextMigrations(migrated).apply(
            diff.toMigration('20260731000100_CreateCatalog', 'CreateCatalog'),
        );
        await seed(migrated);
        const line = requireDefined(await migrated.lines.find('ord_1', 1));
        const tag = requireDefined(await migrated.tags.find('tag_new'));
        migrated.link(line, entity => entity.tags, tag);
        await migrated.saveChanges();

        const rows = await migrated.database.connection.query({
            text: 'select * from "order_line_tags"',
            values: [],
        });
        expect(rows.rows).toHaveLength(1);
        await migrated.dispose();
    });

    it('writes join rows carrying every key column', async () => {
        const line = await db.lines.find('ord_1', 1);
        const tag = await db.tags.find('tag_new');
        db.link(requireDefined(line), entity => entity.tags, requireDefined(tag));
        await db.saveChanges();

        const rows = await db.database.connection.query<{ order_id: string; line_number: number; tag_id: string }>({
            text: 'select "order_id", "line_number", "tag_id" from "order_line_tags"',
            values: [],
        });
        expect(rows.rows).toEqual([{ order_id: 'ord_1', line_number: 1, tag_id: 'tag_new' }]);
    });

    it('loads the collection matching on the whole key', async () => {
        const first = await db.lines.find('ord_1', 1);
        const second = await db.lines.find('ord_1', 2);
        const other = await db.lines.find('ord_2', 1);
        const newTag = await db.tags.find('tag_new');
        const hotTag = await db.tags.find('tag_hot');

        db.link(requireDefined(first), entity => entity.tags, requireDefined(newTag));
        db.link(requireDefined(first), entity => entity.tags, requireDefined(hotTag));
        db.link(requireDefined(second), entity => entity.tags, requireDefined(hotTag));
        db.link(requireDefined(other), entity => entity.tags, requireDefined(newTag));
        await db.saveChanges();
        db.changeTracker.clear();

        const lines = await db.lines
            .orderBy(line => line.orderId)
            .orderBy(line => line.lineNumber)
            .include(line => line.tags)
            .toArray();

        expect(lines.map(line => requireDefined(line.tags).map(tag => tag.id).sort())).toEqual([
            ['tag_hot', 'tag_new'],
            ['tag_hot'],
            // ord_2/1 shares a line number with ord_1/1 and must not inherit its tags.
            ['tag_new'],
        ]);
    });

    it('loads the inverse collection', async () => {
        const line = await db.lines.find('ord_1', 2);
        const hotTag = await db.tags.find('tag_hot');
        db.link(requireDefined(line), entity => entity.tags, requireDefined(hotTag));
        await db.saveChanges();
        db.changeTracker.clear();

        const tags = await db.tags.where(tag => tag.id.eq('tag_hot')).include(tag => tag.lines).toArray();

        expect(requireDefined(tags[0].lines).map(item => [item.orderId, item.lineNumber])).toEqual([['ord_1', 2]]);
    });

    it('unlinks the row it wrote', async () => {
        const line = await db.lines.find('ord_1', 1);
        const tag = await db.tags.find('tag_new');
        db.link(requireDefined(line), entity => entity.tags, requireDefined(tag));
        await db.saveChanges();

        db.unlink(requireDefined(line), entity => entity.tags, requireDefined(tag));
        await db.saveChanges();

        const rows = await db.database.connection.query({ text: 'select * from "order_line_tags"', values: [] });
        expect(rows.rows).toEqual([]);
    });

    it('filters by related rows across the whole key', async () => {
        const first = await db.lines.find('ord_1', 1);
        const newTag = await db.tags.find('tag_new');
        db.link(requireDefined(first), entity => entity.tags, requireDefined(newTag));
        await db.saveChanges();
        db.changeTracker.clear();

        const tagged = await db.lines.whereHas(line => line.tags, tag => tag.id.eq('tag_new')).toArray();

        expect(tagged.map(line => [line.orderId, line.lineNumber])).toEqual([['ord_1', 1]]);
    });

    it('reports a join column count that does not match the key', () => {
        const model = new ModelBuilderImplementation();
        model.entity(Tag, entity => {
            entity.toTable('tags');
            entity.hasKey(tag => tag.id);
            entity.property(tag => tag.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(tag => tag.name).hasColumnName('name').hasColumnType('text').isRequired();
        });
        model.entity(OrderLine, entity => {
            entity.toTable('order_lines');
            entity.hasKey(line => [line.orderId, line.lineNumber]);
            entity.property(line => line.orderId).hasColumnName('order_id').hasColumnType('text').isRequired();
            entity.property(line => line.lineNumber).hasColumnName('line_number').hasColumnType('integer').isRequired();
            entity.property(line => line.sku).hasColumnName('sku').hasColumnType('text').isRequired();
            entity.hasManyToMany(Tag, line => line.tags)
                .usingJoinTable('order_line_tags', join => {
                    // One column for a two-column key.
                    join.sourceForeignKey('order_id');
                    join.targetForeignKey('tag_id');
                });
        });

        expect(() => model.build()).toThrow(
            'declares 1 source foreign key column(s), but the entity key has 2',
        );
    });

    it('rejects a join side that lists a column twice', () => {
        const model = new ModelBuilderImplementation();
        expect(() => model.entity(OrderLine, entity => {
            entity.toTable('order_lines');
            entity.hasKey(line => [line.orderId, line.lineNumber]);
            entity.hasManyToMany(Tag, line => line.tags)
                .usingJoinTable('order_line_tags', join => {
                    join.sourceForeignKey(['order_id', 'order_id']);
                });
        })).toThrow('lists column \'order_id\' more than once');
    });

    it('rejects empty and whitespace-only join-column identifiers', () => {
        expect(() => new ModelBuilderImplementation().entity(OrderLine, entity => {
            entity.toTable('order_lines');
            entity.hasKey(line => [line.orderId, line.lineNumber]);
            entity.hasManyToMany(Tag, line => line.tags)
                .usingJoinTable('order_line_tags', join => {
                    join.sourceForeignKey(['order_id', '   ']);
                });
        })).toThrow(
            'sourceForeignKey requires every column name to be non-empty.',
        );

        expect(() => new ModelBuilderImplementation().entity(OrderLine, entity => {
            entity.toTable('order_lines');
            entity.hasKey(line => [line.orderId, line.lineNumber]);
            entity.hasManyToMany(Tag, line => line.tags)
                .usingJoinTable('order_line_tags', join => {
                    join.targetForeignKey('');
                });
        })).toThrow(
            'targetForeignKey requires every column name to be non-empty.',
        );
    });
});

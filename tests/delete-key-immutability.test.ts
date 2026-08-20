import type {
    DbContextOptionsBuilder,
    ModelBuilder,
} from '../packages/core/src';
import {
    DbContext,
    valueConverter,
} from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';

class DeleteItem {
    public id!: string;
    public name!: string;
}

class CompositeDeleteItem {
    public tenantId!: string;
    public id!: string;
    public name!: string;
}

class ConvertedDeleteItem {
    public id!: string;
    public name!: string;
}

class SoftDeleteItem {
    public id!: string;
    public name!: string;
    public deletedAt?: Date | null;
}

const numericString = valueConverter<string, number>({
    toProvider: value => Number(value),
    fromProvider: value => String(value),
});

class DeleteIdentityContext extends DbContext {
    public items = this.set(DeleteItem);
    public compositeItems = this.set(CompositeDeleteItem);
    public convertedItems = this.set(ConvertedDeleteItem);
    public softItems = this.set(SoftDeleteItem);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(DeleteItem, entity => {
            entity.toTable('delete_items');
            entity.hasKey(item => item.id);
            entity.property(item => item.id).hasColumnType('text').isRequired();
            entity.property(item => item.name).hasColumnType('text').isRequired();
        });
        model.entity(CompositeDeleteItem, entity => {
            entity.toTable('composite_delete_items');
            entity.hasKey(item => [item.tenantId, item.id]);
            entity.property(item => item.tenantId).hasColumnType('text').isRequired();
            entity.property(item => item.id).hasColumnType('text').isRequired();
            entity.property(item => item.name).hasColumnType('text').isRequired();
        });
        model.entity(ConvertedDeleteItem, entity => {
            entity.toTable('converted_delete_items');
            entity.hasKey(item => item.id);
            entity.property(item => item.id).hasColumnType('integer').isRequired()
                .hasConversion(numericString);
            entity.property(item => item.name).hasColumnType('text').isRequired();
        });
        model.entity(SoftDeleteItem, entity => {
            entity.toTable('soft_delete_items');
            entity.hasKey(item => item.id);
            entity.softDelete(item => item.deletedAt);
            entity.property(item => item.id).hasColumnType('text').isRequired();
            entity.property(item => item.name).hasColumnType('text').isRequired();
            entity.property(item => item.deletedAt).hasColumnType('timestamp');
        });
    }
}

async function start(): Promise<DeleteIdentityContext> {
    const db = DeleteIdentityContext.create();
    await db.database.connection.query({
        text: db.database.createScript(),
        values: [],
    });
    return db;
}

describe('delete key immutability', () => {
    it.each(['before', 'after'] as const)(
        'rejects a single-key mutation %s remove without deleting either row',
        async timing => {
            const db = await start();
            const first = Object.assign(new DeleteItem(), { id: '1', name: 'one' });
            const second = Object.assign(new DeleteItem(), { id: '2', name: 'two' });
            db.items.add(first);
            db.items.add(second);
            await db.saveChanges();

            if (timing === 'before') {
                first.id = '2';
            }
            db.items.remove(first);
            if (timing === 'after') {
                first.id = '2';
            }

            await expect(db.saveChanges()).rejects.toThrow(
                'Primary key changes are not supported for entity \'DeleteItem\' (property \'id\').',
            );
            const rows = await db.database.connection.query<{ id: string }>({
                text: 'select id from delete_items order by id',
                values: [],
            });
            expect(rows.rows).toEqual([{ id: '1' }, { id: '2' }]);
            await db.dispose();
        },
    );

    it('rejects a composite-key mutation before a hard delete', async () => {
        const db = await start();
        const item = Object.assign(new CompositeDeleteItem(), {
            tenantId: 'tenant-a', id: '1', name: 'one',
        });
        db.compositeItems.add(item);
        await db.saveChanges();

        db.compositeItems.remove(item);
        item.tenantId = 'tenant-b';

        await expect(db.saveChanges()).rejects.toThrow(
            'Primary key changes are not supported for entity \'CompositeDeleteItem\' (property \'tenantId\').',
        );
        await db.dispose();
    });

    it('rejects a converted-key mutation before a hard delete', async () => {
        const db = await start();
        const item = Object.assign(new ConvertedDeleteItem(), { id: '1', name: 'one' });
        db.convertedItems.add(item);
        await db.saveChanges();

        item.id = '2';
        db.convertedItems.remove(item);

        await expect(db.saveChanges()).rejects.toThrow(
            'Primary key changes are not supported for entity \'ConvertedDeleteItem\' (property \'id\').',
        );
        await db.dispose();
    });

    it('applies the same key immutability rule to soft deletes', async () => {
        const db = await start();
        const item = Object.assign(new SoftDeleteItem(), {
            id: '1', name: 'one', deletedAt: null,
        });
        db.softItems.add(item);
        await db.saveChanges();

        db.softItems.remove(item);
        item.id = '2';

        await expect(db.saveChanges()).rejects.toThrow(
            'Primary key changes are not supported for entity \'SoftDeleteItem\' (property \'id\').',
        );
        await db.dispose();
    });
});

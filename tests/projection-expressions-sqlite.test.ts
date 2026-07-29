import type {
    DbContextOptionsBuilder,
    ModelBuilder,
} from '../src';
import { DbContext } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

class InventoryItem {
    public id!: string;
    public name!: string;
    public nickname!: string | null;
    public quantity!: number;

    constructor(data?: Partial<InventoryItem>) {
        Object.assign(this, data);
    }
}

class InventoryContext extends DbContext {
    public items = this.set(InventoryItem);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(InventoryItem, entity => {
            entity.toTable('inventory_items');
            entity.hasKey(item => item.id);
            entity.property(item => item.id).hasColumnType('text').isRequired();
            entity.property(item => item.name).hasColumnType('text').isRequired();
            entity.property(item => item.nickname).hasColumnType('text');
            entity.property(item => item.quantity).hasColumnType('integer').isRequired();
        });
    }
}

describe('SQLite typed projection expressions', () => {
    it('executes nested string, null, and arithmetic expressions', async () => {
        const db = InventoryContext.create();
        await db.database.connection.query({
            text: db.database.createScript(),
            values: [],
        });
        db.items.add(new InventoryItem({
            id: 'item_1',
            name: '  Widget  ',
            nickname: null,
            quantity: 7,
        }));
        await db.saveChanges();

        const rows = await db.items
            .select((item, sql) => ({
                labels: {
                    normalized: sql.lower(sql.trim(item.name)),
                    display: sql.concat(
                        sql.upper(sql.trim(item.name)),
                        sql.literal(' #'),
                        item.id,
                    ),
                    nickname: sql.coalesce(
                        item.nickname,
                        sql.literal('none'),
                    ),
                    nameLength: sql.length(sql.trim(item.name)),
                },
                arithmetic: {
                    plus: sql.add(item.quantity, sql.literal(2)),
                    minus: sql.subtract(item.quantity, sql.literal(2)),
                    doubled: sql.multiply(item.quantity, sql.literal(2)),
                    remainder: sql.modulo(item.quantity, sql.literal(2)),
                },
            }))
            .single();

        expect(rows).toEqual({
            labels: {
                normalized: 'widget',
                display: 'WIDGET #item_1',
                nickname: 'none',
                nameLength: 6,
            },
            arithmetic: {
                plus: 9,
                minus: 5,
                doubled: 14,
                remainder: 1,
            },
        });
        expect(db.changeTracker.entries()).toHaveLength(1);
        await db.dispose();
    });
});

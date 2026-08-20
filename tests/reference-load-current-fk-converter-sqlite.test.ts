import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, valueConverter } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { requireDefined } from './support/require-defined';

let conversions = 0;
const countedIdentity = valueConverter<string, string>({
    toProvider: value => {
        conversions += 1;
        return value;
    },
    fromProvider: value => value,
});

class ConvertedParent {
    public id = '';
}

class ConvertedChild {
    public id = '';
    public parentId = '';
    public parent: ConvertedParent | null = null;
}

class ConvertedReferenceContext extends DbContext {
    public parents = this.set(ConvertedParent);
    public children = this.set(ConvertedChild);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(ConvertedParent, entity => {
            entity.toTable('converted_reference_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text')
                .hasConversion(countedIdentity).isRequired();
        });
        model.entity(ConvertedChild, entity => {
            entity.toTable('converted_reference_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('text').hasConversion(countedIdentity)
                .isRequired();
            entity.hasOne(ConvertedParent, row => row.parent)
                .withMany()
                .hasForeignKey(row => row.parentId);
        });
    }
}

describe('current converted reference FK loading', () => {
    it('captures one current provider tuple for SQL and stitching', async () => {
        const db = ConvertedReferenceContext.create();
        await db.database.connection.query({
            text: db.database.createScript(), values: [],
        });
        await db.database.connection.query({
            text: 'insert into converted_reference_parents (id) values (?), (?)',
            values: ['p1', 'p2'],
        });
        await db.database.connection.query({
            text: `insert into converted_reference_children
                (id, parent_id) values (?, ?)`,
            values: ['c', 'p1'],
        });
        const child = requireDefined(await db.children.find('c'));
        conversions = 0;
        child.parentId = 'p2';

        const parent = await requireDefined(db.entry(child))
            .reference(row => row.parent).load();

        expect(parent?.id).toBe('p2');
        expect(child.parent).toBe(parent);
        expect(conversions).toBe(1);
        await db.dispose();
    });

    it('keeps the bound fact for an unchanged converted FK', async () => {
        const db = ConvertedReferenceContext.create();
        await db.database.connection.query({
            text: db.database.createScript(), values: [],
        });
        await db.database.connection.query({
            text: 'insert into converted_reference_parents (id) values (?)',
            values: ['p1'],
        });
        await db.database.connection.query({
            text: `insert into converted_reference_children
                (id, parent_id) values (?, ?)`,
            values: ['c', 'p1'],
        });
        const child = requireDefined(await db.children.find('c'));
        conversions = 0;

        const parent = await requireDefined(db.entry(child))
            .reference(row => row.parent).load();

        expect(parent?.id).toBe('p1');
        expect(child.parent).toBe(parent);
        expect(conversions).toBe(0);
        await db.dispose();
    });
});

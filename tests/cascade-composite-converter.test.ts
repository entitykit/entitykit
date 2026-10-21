import {
    DbContext, DeleteBehavior, EntityState, valueConverter,
    type DbContextOptionsBuilder, type ModelBuilder,
} from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';

class CompositeParent {
    public region = 0;
    public id = 0;
    public children: CompositeChild[] = [];
}

class CompositeChild {
    public id = 0;
    public parentRegion: number | null = null;
    public parentId: number | null = null;
    public parent: CompositeParent | null = null;
}

class CompositeConverterContext extends DbContext {
    public parents = this.set(CompositeParent);
    public children = this.set(CompositeChild);
    public beforeForeignKeyConversion?: () => void;

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(CompositeParent, entity => {
            entity.toTable('composite_converter_parents');
            entity.hasKey(row => [row.region, row.id]);
            entity.property(row => row.region).hasColumnType('integer').isRequired();
            entity.property(row => row.id).hasColumnType('integer').isRequired();
        });
        model.entity(CompositeChild, entity => {
            entity.toTable('composite_converter_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            entity.property(row => row.parentRegion).hasColumnType('integer');
            // Only the second member of the optional composite key has a callback.
            entity.property(row => row.parentId).hasColumnType('integer')
                .hasConversion(valueConverter<number | null, number | null>({
                    toProvider: value => {
                        this.beforeForeignKeyConversion?.();
                        return value;
                    },
                    fromProvider: value => value,
                }));
            entity.hasOne(CompositeParent, row => row.parent).withMany(row => row.children)
                .hasForeignKey(row => [row.parentRegion, row.parentId]).onDelete(DeleteBehavior.SetNull);
        });
    }
}

describe('SetNull with a converter on one composite foreign-key member', () => {
    it('publishes inverse cleanup before the next child conversion and clears both key members', async () => {
        const db = CompositeConverterContext.create();
        try {
            await db.database.ensureCreated();
            await db.database.connection.query({
                text: 'insert into composite_converter_parents values (1, 10)', values: [],
            });
            await db.database.connection.query({
                text: 'insert into composite_converter_children values (1, 1, 10), (2, 1, 10)', values: [],
            });
            const parent = await db.parents.include(row => row.children).single();
            const children = [...parent.children];
            expect(children.map(child => child.id)).toStrictEqual([1, 2]);
            const observations: Array<{ references: Array<number | null>; inverse: number[] }> = [];
            db.beforeForeignKeyConversion = () => {
                if (children[0].parent !== null || children[1].parent !== parent) return;
                observations.push({
                    references: children.map(child => child.parent?.id ?? null),
                    inverse: parent.children.map(child => child.id),
                });
                parent.children = parent.children.filter(child => child.parent !== null);
            };
            db.parents.remove(parent);

            await expect(db.saveChanges()).resolves.toBe(3);

            expect(observations.length).toBeGreaterThan(0);
            for (const observation of observations) {
                expect(observation).toStrictEqual({ references: [null, 10], inverse: [2] });
            }
            expect(parent.children).toStrictEqual([]);
            expect(parent.children).toHaveLength(0);
            expect(db.entry(parent)).toBeUndefined();
            expect(children.map(child => [child.parent, child.parentRegion, child.parentId]))
                .toStrictEqual([[null, null, null], [null, null, null]]);
            expect(children.map(child => db.entry(child)?.state))
                .toStrictEqual([EntityState.Unchanged, EntityState.Unchanged]);
            await expect(db.parents.asNoTracking().count()).resolves.toBe(0);
            const stored = await db.children.orderBy(row => row.id).asNoTracking().toArray();
            expect(stored.map(child => [child.id, child.parentRegion, child.parentId]))
                .toStrictEqual([[1, null, null], [2, null, null]]);
            await expect(db.saveChanges()).resolves.toBe(0);
        } finally {
            await db.dispose();
        }
    });
});

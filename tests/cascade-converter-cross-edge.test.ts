import {
    DbContext, DeleteBehavior, EntityState, valueConverter,
    type DbContextOptionsBuilder, type ModelBuilder,
} from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';

class CrossEdgeParent {
    public id = 0;
    public children: CascadeChild[] = [];
}

class CascadeChild {
    public id = 0;
    public parentId = 0;
    public parent: CrossEdgeParent | null = null;
}

class ConvertedChild {
    public id = 0;
    public parentId: number | null = null;
    public parent: CrossEdgeParent | null = null;
}

class CrossEdgeContext extends DbContext {
    public parents = this.set(CrossEdgeParent);
    public cascadeChildren = this.set(CascadeChild);
    public convertedChildren = this.set(ConvertedChild);
    public beforeForeignKeyConversion?: () => void;

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(CrossEdgeParent, entity => {
            entity.toTable('cross_edge_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
        });
        model.entity(CascadeChild, entity => {
            entity.toTable('cross_edge_cascade_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            entity.property(row => row.parentId).hasColumnType('integer').isRequired();
            entity.hasOne(CrossEdgeParent, row => row.parent).withMany(row => row.children)
                .hasForeignKey(row => row.parentId).onDelete(DeleteBehavior.Cascade);
        });
        model.entity(ConvertedChild, entity => {
            entity.toTable('cross_edge_converted_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            entity.property(row => row.parentId).hasColumnType('integer')
                .hasConversion(valueConverter<number | null, number | null>({
                    toProvider: value => {
                        this.beforeForeignKeyConversion?.();
                        return value;
                    },
                    fromProvider: value => value,
                }));
            entity.hasOne(CrossEdgeParent, row => row.parent).withMany()
                .hasForeignKey(row => row.parentId).onDelete(DeleteBehavior.SetNull);
        });
    }
}

describe('cascade publication across converted and unconverted relationships', () => {
    it('publishes earlier inverse removals before a converter on a relationship without an inverse runs', async () => {
        const db = CrossEdgeContext.create();
        try {
            await db.database.ensureCreated();
            await db.database.connection.query({ text: 'insert into cross_edge_parents values (1)', values: [] });
            await db.database.connection.query({ text: 'insert into cross_edge_cascade_children values (1, 1)', values: [] });
            await db.database.connection.query({ text: 'insert into cross_edge_converted_children values (2, 1)', values: [] });
            const parent = await db.parents.include(row => row.children).single();
            const cascadeChild = parent.children[0];
            const convertedChild = await db.convertedChildren.include(row => row.parent).single();
            expect(convertedChild.parent).toBe(parent);
            const observedCollections: number[][] = [];
            db.beforeForeignKeyConversion = () => {
                if (cascadeChild.parent === null) {
                    observedCollections.push(parent.children.map(child => child.id));
                }
            };
            db.parents.remove(parent);

            await expect(db.saveChanges()).resolves.toBe(3);

            expect(observedCollections.length).toBeGreaterThan(0);
            for (const collection of observedCollections) expect(collection).toStrictEqual([]);
            expect(parent.children).toStrictEqual([]);
            expect(cascadeChild.parent).toBeNull();
            expect(db.entry(cascadeChild)).toBeUndefined();
            expect(convertedChild.parent).toBeNull();
            expect(convertedChild.parentId).toBeNull();
            expect(db.entry(convertedChild)?.state).toBe(EntityState.Unchanged);
            await expect(db.parents.asNoTracking().count()).resolves.toBe(0);
            await expect(db.cascadeChildren.asNoTracking().count()).resolves.toBe(0);
            const stored = await db.convertedChildren.asNoTracking().single();
            expect({ id: stored.id, parentId: stored.parentId }).toStrictEqual({ id: 2, parentId: null });
        } finally {
            await db.dispose();
        }
    });
});

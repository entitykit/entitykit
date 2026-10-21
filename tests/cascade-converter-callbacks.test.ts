import {
    DbContext, DeleteBehavior, EntityState, valueConverter,
    type DbContextOptionsBuilder, type ModelBuilder,
} from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';

class ConverterParent {
    public id = 0;
    public children: ConverterChild[] = [];
}

class ConverterChild {
    public id = 0;
    public parentId: number | null = null;
    public parent: ConverterParent | null = null;
}

class ConverterCascadeContext extends DbContext {
    public parents = this.set(ConverterParent);
    public children = this.set(ConverterChild);
    public beforeForeignKeyConversion?: () => void;

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(ConverterParent, entity => {
            entity.toTable('converter_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
        });
        model.entity(ConverterChild, entity => {
            entity.toTable('converter_children');
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
            entity.hasOne(ConverterParent, row => row.parent).withMany(row => row.children)
                .hasForeignKey(row => row.parentId).onDelete(DeleteBehavior.SetNull);
        });
    }
}

interface GraphObservation {
    references: Array<number | null>;
    inverse: number[];
}

async function populate(db: ConverterCascadeContext): Promise<ConverterParent> {
    await db.database.ensureCreated();
    await db.database.connection.query({ text: 'insert into converter_parents values (1)', values: [] });
    await db.database.connection.query({ text: 'insert into converter_children values (1, 1), (2, 1)', values: [] });
    const parent = await db.parents.include(row => row.children).single();
    expect(parent.children.map(child => child.id)).toStrictEqual([1, 2]);
    return parent;
}

function normalizeBetweenRemovals(
    parent: ConverterParent,
    children: ConverterChild[],
    observations: GraphObservation[],
): boolean {
    if (children[0].parent !== null || children[1].parent !== parent) return false;
    observations.push({
        references: children.map(child => child.parent?.id ?? null),
        inverse: parent.children.map(child => child.id),
    });
    parent.children = parent.children.filter(child => child.parent !== null);
    return true;
}

function expectImmediateInverseCleanup(observations: GraphObservation[]): void {
    expect(observations.length).toBeGreaterThan(0);
    for (const observation of observations) {
        expect(observation).toStrictEqual({ references: [null, 1], inverse: [2] });
    }
}

async function expectSaved(
    db: ConverterCascadeContext,
    parent: ConverterParent,
    children: ConverterChild[],
): Promise<void> {
    expect(parent.children).toStrictEqual([]);
    expect(parent.children).toHaveLength(0);
    expect(db.entry(parent)).toBeUndefined();
    expect(children.map(child => [child.parent, child.parentId])).toStrictEqual([[null, null], [null, null]]);
    expect(children.map(child => db.entry(child)?.state))
        .toStrictEqual([EntityState.Unchanged, EntityState.Unchanged]);
    await expect(db.parents.asNoTracking().count()).resolves.toBe(0);
    const stored = await db.children.orderBy(row => row.id).asNoTracking().toArray();
    expect(stored.map(child => ({ id: child.id, parentId: child.parentId })))
        .toStrictEqual([{ id: 1, parentId: null }, { id: 2, parentId: null }]);
    await expect(db.saveChanges()).resolves.toBe(0);
}

describe('SetNull cascade callbacks from synchronous foreign-key converters', () => {
    it('publishes each inverse removal before the next converter can normalize the collection', async () => {
        const db = ConverterCascadeContext.create();
        try {
            const parent = await populate(db);
            const children = [...parent.children];
            const observations: GraphObservation[] = [];
            db.beforeForeignKeyConversion = () => {
                normalizeBetweenRemovals(parent, children, observations);
            };
            db.parents.remove(parent);

            await expect(db.saveChanges()).resolves.toBe(3);

            expectImmediateInverseCleanup(observations);
            await expectSaved(db, parent, children);
        } finally {
            await db.dispose();
        }
    });

    it('restores the graph after a converter rejects between removals and permits retry', async () => {
        const db = ConverterCascadeContext.create();
        try {
            const parent = await populate(db);
            const children = [...parent.children];
            const observations: GraphObservation[] = [];
            db.beforeForeignKeyConversion = () => {
                if (!normalizeBetweenRemovals(parent, children, observations)) return;
                db.beforeForeignKeyConversion = undefined;
                throw new Error('converter refused the remaining foreign key');
            };
            db.parents.remove(parent);

            await expect(db.saveChanges()).rejects.toThrow('converter refused the remaining foreign key');

            expectImmediateInverseCleanup(observations);
            expect(parent.children).toStrictEqual(children);
            expect(children.every(child => child.parent === parent && child.parentId === 1)).toBe(true);
            expect(db.entry(parent)?.state).toBe(EntityState.Deleted);
            expect(children.map(child => db.entry(child)?.state))
                .toStrictEqual([EntityState.Unchanged, EntityState.Unchanged]);
            await expect(db.parents.asNoTracking().count()).resolves.toBe(1);
            const stored = await db.children.orderBy(row => row.id).asNoTracking().toArray();
            expect(stored.map(child => ({ id: child.id, parentId: child.parentId })))
                .toStrictEqual([{ id: 1, parentId: 1 }, { id: 2, parentId: 1 }]);

            observations.length = 0;
            db.beforeForeignKeyConversion = () => {
                normalizeBetweenRemovals(parent, children, observations);
            };
            await expect(db.saveChanges()).resolves.toBe(3);
            expectImmediateInverseCleanup(observations);
            await expectSaved(db, parent, children);
        } finally {
            await db.dispose();
        }
    });
});

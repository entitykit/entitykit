import type {
    DbContextOptionsBuilder,
    ModelBuilder,
    SaveChangesInterceptor,
} from '../src';
import { DbContext, EntityState } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

class InvalidationParent {
    private storedId = 0;
    public sku = '';
    public name = '';
    public children: InvalidationChild[] = [];
    public onGenerated?: (value: number) => void;
    public get id(): number {
        return this.storedId;
    }
    public set id(value: number) {
        this.storedId = value;
        if (value > 0) this.onGenerated?.(value);
    }
}

class InvalidationChild {
    public id = '';
    public parentId = 0;
    public parent: InvalidationParent | null = null;
}

class InvalidationFailure {
    public id = '';
    public parentId = 0;
    public code = '';
    public parent: InvalidationParent | null = null;
}

class GeneratedIdentityInvalidationContext extends DbContext {
    public parents = this.set(InvalidationParent);
    public children = this.set(InvalidationChild);
    public failures = this.set(InvalidationFailure);

    constructor(
        private readonly interceptors: readonly SaveChangesInterceptor[] = [],
    ) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
        for (const interceptor of this.interceptors) {
            options.useSaveInterceptor(interceptor);
        }
    }

    protected override model(model: ModelBuilder): void {
        model.entity(InvalidationParent, entity => {
            entity.toTable('invalidation_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().useSqliteRowId();
            entity.property(row => row.sku).hasColumnType('text').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
            entity.hasIndex(row => row.sku).isUnique();
            entity.hasIndex(row => row.name).isUnique();
        });
        model.entity(InvalidationChild, entity => {
            entity.toTable('invalidation_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('integer').isRequired();
            entity.hasOne(InvalidationParent, row => row.parent)
                .withMany(row => row.children)
                .hasForeignKey(row => row.parentId);
        });
        model.entity(InvalidationFailure, entity => {
            entity.toTable('invalidation_failures');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('integer').isRequired();
            entity.property(row => row.code).hasColumnType('text').isRequired();
            entity.hasIndex(row => row.code).isUnique();
            entity.hasOne(InvalidationParent, row => row.parent)
                .withMany().hasForeignKey(row => row.parentId);
        });
    }
}

const upsertOptions = {
    conflictProperties: ['sku'] as const,
    updateProperties: ['name'] as const,
};

async function open(
    interceptors: readonly SaveChangesInterceptor[] = [],
): Promise<GeneratedIdentityInvalidationContext> {
    const db = GeneratedIdentityInvalidationContext.create(interceptors);
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: `insert into invalidation_parents (id, sku, name)
            values (?, ?, ?), (?, ?, ?)`,
        values: [0, 'zero', 'zero', 2, 'existing', 'existing'],
    });
    await db.database.connection.query({
        text: `insert into invalidation_children (id, parent_id)
            values (?, ?)`,
        values: ['existing-child', 2],
    });
    await db.database.connection.query({
        text: `insert into invalidation_failures (id, parent_id, code)
            values (?, ?, ?)`,
        values: ['durable-failure', 2, 'duplicate'],
    });
    return db;
}

async function occupyNextId(
    db: GeneratedIdentityInvalidationContext,
): Promise<void> {
    await db.database.connection.query({
        text: 'insert into invalidation_parents (sku, name) values (?, ?)',
        values: ['unrelated', 'unrelated'],
    });
}

async function storedParentId(
    db: GeneratedIdentityInvalidationContext,
    childId: string,
): Promise<number | undefined> {
    const result = await db.database.connection.query<{ parent_id: number }>({
        text: 'select parent_id from invalidation_children where id = ?',
        values: [childId],
    });
    return result.rows[0]?.parent_id;
}

const planningPaths = [
    'no inspection',
    'detectChanges()',
    'getSavePlan()',
    'getSavePlanDebugView()',
    'no-op interceptor',
] as const;

describe('generated identity invalidation on SQLite', () => {
    it.each(planningPaths)(
        'fails closed on a setter-observed existing FK after failure and %s',
        async path => {
            const db = await open(path === 'no-op interceptor'
                ? [{ savingChanges: () => undefined }]
                : []);
            const child = await db.children.find('existing-child');
            if (!child) throw new Error('Expected existing child.');
            const parent = Object.assign(new InvalidationParent(), {
                sku: `tracked-${path}`,
                name: 'tracked',
                onGenerated: (value: number) => {
                    child.parentId = value;
                },
            });
            const failure = Object.assign(new InvalidationFailure(), {
                id: `failure-${path}`,
                code: 'duplicate',
                parent,
            });
            db.parents.add(parent);
            db.failures.add(failure);

            await expect(db.saveChanges()).rejects.toThrow();
            expect(parent.id).toBe(0);
            expect(child.parentId).toBe(3);
            expect(db.entry(parent)?.state).toBe(EntityState.Added);
            expect(db.entry(child)?.state).toBe(EntityState.Unchanged);
            db.failures.remove(failure);
            if (path === 'detectChanges()') {
                expect(() => {
                    db.changeTracker.detectChanges();
                }).toThrow(
                    'has not been generated yet',
                );
            }
            if (path === 'getSavePlan()') {
                expect(() => db.getSavePlan()).toThrow(
                    'has not been generated yet',
                );
            }
            if (path === 'getSavePlanDebugView()') {
                expect(() => db.getSavePlanDebugView()).toThrow(
                    'has not been generated yet',
                );
            }
            await occupyNextId(db);

            await expect(db.saveChanges()).rejects.toThrow(
                'has not been generated yet',
            );
            await expect(storedParentId(db, child.id)).resolves.toBe(2);
            child.parentId = 2;
            child.parent = null;
            await expect(db.saveChanges()).resolves.toBe(1);
            expect(parent.id).toBe(4);
            child.parent = parent;
            await expect(db.saveChanges()).resolves.toBe(1);
            await expect(storedParentId(db, child.id)).resolves.toBe(4);
            await db.dispose();
        },
    );

    it('retargets an added dependent after pre-acceptance failure', async () => {
        const db = await open();
        const child = Object.assign(new InvalidationChild(), {
            id: 'added-child', parentId: 2,
        });
        const parent = Object.assign(new InvalidationParent(), {
            sku: 'tracked-added', name: 'tracked-added',
            onGenerated: (value: number) => {
                child.parentId = value;
            },
        });
        const failure = Object.assign(new InvalidationFailure(), {
            id: 'failure-added', code: 'duplicate', parent,
        });
        db.parents.add(parent);
        db.children.add(child);
        db.failures.add(failure);

        await expect(db.saveChanges()).rejects.toThrow();
        expect(parent.id).toBe(0);
        expect(child.parentId).toBe(3);
        db.failures.remove(failure);
        await occupyNextId(db);

        await expect(db.saveChanges()).resolves.toBe(2);
        expect(child).toMatchObject({ parentId: 4, parent });
        await expect(storedParentId(db, child.id)).resolves.toBe(4);
        await db.dispose();
    });

    it.each(['outer', 'nested'] as const)(
        'fails closed for a scalar FK after %s generated-upsert rollback',
        async scope => {
            const db = await open();
            const parent = Object.assign(new InvalidationParent(), {
                sku: `upsert-${scope}`, name: 'upsert',
            });
            const child = Object.assign(new InvalidationChild(), {
                id: `upsert-child-${scope}`,
            });
            const useGeneratedIdentity = async (
                tx: GeneratedIdentityInvalidationContext,
            ): Promise<void> => {
                await tx.parents.upsert([parent], upsertOptions);
                child.parentId = parent.id;
                tx.children.add(child);
                throw new Error(`abort ${scope}`);
            };
            if (scope === 'outer') {
                await expect(db.transaction(useGeneratedIdentity))
                    .rejects.toThrow('abort outer');
            } else {
                await db.transaction(async outer => {
                    await expect(outer.transaction(useGeneratedIdentity))
                        .rejects.toThrow('abort nested');
                });
            }
            expect(parent.id).toBe(0);
            expect(child.parentId).toBe(3);
            await occupyNextId(db);
            await db.parents.upsert([parent], upsertOptions);
            expect(parent.id).toBe(4);

            await expect(db.saveChanges()).rejects.toThrow(
                'retains a rolled-back store-generated FK',
            );
            await expect(storedParentId(db, child.id)).resolves.toBeUndefined();
            child.parentId = parent.id;
            await expect(db.saveChanges()).resolves.toBe(1);
            await expect(storedParentId(db, child.id)).resolves.toBe(4);
            await db.dispose();
        },
    );

    it('retargets an explicit navigation to a retried upsert source', async () => {
        const db = await open();
        const child = await db.children.find('existing-child');
        if (!child) throw new Error('Expected existing child.');
        const parent = Object.assign(new InvalidationParent(), {
            sku: 'explicit-upsert', name: 'upsert',
        });
        await expect(db.transaction(async tx => {
            await tx.parents.upsert([parent], upsertOptions);
            child.parentId = parent.id;
            child.parent = parent;
            throw new Error('abort explicit upsert');
        })).rejects.toThrow('abort explicit upsert');
        await occupyNextId(db);
        await db.parents.upsert([parent], upsertOptions);

        await expect(db.saveChanges()).resolves.toBe(1);
        await expect(storedParentId(db, child.id)).resolves.toBe(4);
        await db.dispose();
    });

    it('invalidates an observed ID when a later generated upsert row fails', async () => {
        const db = await open();
        const child = await db.children.find('existing-child');
        if (!child) throw new Error('Expected existing child.');
        const first = Object.assign(new InvalidationParent(), {
            sku: 'first-batch', name: 'first',
        });
        first.onGenerated = (value: number) => {
            child.parentId = value;
        };
        const second = Object.assign(new InvalidationParent(), {
            sku: 'zero', name: 'duplicate unique value',
        });
        await expect(db.parents.upsert([first, second], {
            conflictProperties: ['name'], updateProperties: ['sku'],
        })).rejects.toThrow();
        expect(first.id).toBe(0);
        expect(child.parentId).toBe(3);
        first.onGenerated = undefined;
        await occupyNextId(db);
        await db.parents.upsert([first], upsertOptions);

        await expect(db.saveChanges()).rejects.toThrow(
            'retains a rolled-back store-generated FK',
        );
        await expect(storedParentId(db, child.id)).resolves.toBe(2);
        await db.dispose();
    });
});

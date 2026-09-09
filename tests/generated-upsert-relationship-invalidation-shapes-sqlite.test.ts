import type {
    DbContextOptionsBuilder,
    ModelBuilder,
    SaveChangesInterceptor,
} from '../packages/core/src';
import { DbContext } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';

class GeneratedAlternateParent {
    public id = '';
    public token!: string;
    public name = '';
    public children: GeneratedAlternateChild[] = [];
}

class GeneratedAlternateChild {
    public id = '';
    public parentToken = '';
    public parent: GeneratedAlternateParent | null = null;
}

class GeneratedAlternateContext extends DbContext {
    public parents = this.set(GeneratedAlternateParent);
    public children = this.set(GeneratedAlternateChild);

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
        model.entity(GeneratedAlternateParent, entity => {
            entity.toTable('generated_alternate_parents');
            entity.hasKey(row => row.id);
            entity.hasAlternateKey(row => row.token);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.token).hasColumnType('text').isRequired()
                .hasDefaultSql('(lower(hex(randomblob(8))))')
                .valueGeneratedOnAdd();
            entity.property(row => row.name).hasColumnType('text').isRequired();
        });
        model.entity(GeneratedAlternateChild, entity => {
            entity.toTable('generated_alternate_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentToken).hasColumnName('parent_token')
                .hasColumnType('text').isRequired();
            entity.hasOne(GeneratedAlternateParent, row => row.parent)
                .withMany(row => row.children)
                .hasForeignKey(row => row.parentToken)
                .hasPrincipalKey(row => row.token);
        });
    }
}

const upsertOptions = {
    conflictProperties: ['id'] as const,
    updateProperties: ['name'] as const,
};

async function open(
    interceptors: readonly SaveChangesInterceptor[] = [],
): Promise<GeneratedAlternateContext> {
    const db = GeneratedAlternateContext.create(interceptors);
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: `insert into generated_alternate_parents (id, token, name)
            values (?, ?, ?)`,
        values: ['durable', 'durable-token', 'durable'],
    });
    await db.database.connection.query({
        text: `insert into generated_alternate_children (id, parent_token)
            values (?, ?)`,
        values: ['existing', 'durable-token'],
    });
    return db;
}

async function occupyToken(
    db: GeneratedAlternateContext,
    token: string,
): Promise<void> {
    await db.database.connection.query({
        text: `insert into generated_alternate_parents (id, token, name)
            values (?, ?, ?)`,
        values: [`unrelated-${token}`, token, 'unrelated'],
    });
}

async function storedToken(
    db: GeneratedAlternateContext,
    childId: string,
): Promise<string | undefined> {
    const result = await db.database.connection.query<{ parent_token: string }>({
        text: `select parent_token from generated_alternate_children
            where id = ?`,
        values: [childId],
    });
    return result.rows[0]?.parent_token;
}

const planningPaths = [
    'no inspection',
    'detectChanges()',
    'getSavePlan()',
    'getSavePlanDebugView()',
    'no-op interceptor',
] as const;

describe('generated upsert relationship invalidation shapes', () => {
    it.each(planningPaths)(
        'retains a stale generated alternate key through %s',
        async path => {
            const db = await open(path === 'no-op interceptor'
                ? [{ savingChanges: () => undefined }]
                : []);
            const parent = Object.assign(new GeneratedAlternateParent(), {
                id: `intended-${path}`, name: 'intended',
            });
            const child = Object.assign(new GeneratedAlternateChild(), {
                id: `added-${path}`,
            });
            await expect(db.transaction(async tx => {
                await tx.parents.executeUpsert([parent], upsertOptions);
                child.parentToken = parent.token;
                tx.children.add(child);
                throw new Error('abort generated alternate');
            })).rejects.toThrow('abort generated alternate');
            const rolledBackToken = child.parentToken;
            expect(parent.token).toBeUndefined();
            await occupyToken(db, rolledBackToken);
            await db.parents.executeUpsert([parent], upsertOptions);
            expect(parent.token).not.toBe(rolledBackToken);

            if (path === 'detectChanges()') {
                expect(() => {
                    db.changeTracker.detectChanges();
                }).toThrow(
                    'retains a rolled-back store-generated FK',
                );
            }
            if (path === 'getSavePlan()') {
                expect(() => db.getSavePlan()).toThrow(
                    'retains a rolled-back store-generated FK',
                );
            }
            if (path === 'getSavePlanDebugView()') {
                expect(() => db.getSavePlanDebugView()).toThrow(
                    'retains a rolled-back store-generated FK',
                );
            }
            await expect(db.saveChanges()).rejects.toThrow(
                'retains a rolled-back store-generated FK',
            );
            await expect(db.saveChanges()).rejects.toThrow(
                'retains a rolled-back store-generated FK',
            );
            await expect(storedToken(db, child.id)).resolves.toBeUndefined();
            child.parentToken = parent.token;
            await expect(db.saveChanges()).resolves.toBe(1);
            await expect(storedToken(db, child.id)).resolves.toBe(parent.token);
            await db.dispose();
        },
    );

    it('blocks an existing dependent after a nested savepoint rollback', async () => {
        const db = await open();
        const child = await db.children.find('existing');
        if (!child) throw new Error('Expected existing child.');
        const parent = Object.assign(new GeneratedAlternateParent(), {
            id: 'nested-intended', name: 'nested',
        });
        await db.transaction(async outer => {
            await expect(outer.transaction(async nested => {
                await nested.parents.executeUpsert([parent], upsertOptions);
                child.parentToken = parent.token;
                throw new Error('abort nested alternate');
            })).rejects.toThrow('abort nested alternate');
        });
        const rolledBackToken = child.parentToken;
        await occupyToken(db, rolledBackToken);
        await db.parents.executeUpsert([parent], upsertOptions);

        await expect(db.saveChanges()).rejects.toThrow(
            'retains a rolled-back store-generated FK',
        );
        await expect(storedToken(db, child.id)).resolves.toBe('durable-token');
        child.parentToken = parent.token;
        await expect(db.saveChanges()).resolves.toBe(1);
        await expect(storedToken(db, child.id)).resolves.toBe(parent.token);
        await db.dispose();
    });
});

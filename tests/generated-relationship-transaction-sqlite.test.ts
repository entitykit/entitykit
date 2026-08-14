import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, EntityState } from '../src';
import type { EntityEntry } from '../src/tracking/entity-entry';
import { activeTemporaryGeneratedIdentity } from '../src/tracking/temporary-generated-identity';
import { sqliteProviderServices } from '../src/providers/sqlite';
import { internalEntityEntry } from './support/public-api-internals';

class SqliteTransactionParent {
    public id = 0;
    public name = '';
    public children: SqliteTransactionChild[] = [];
}

class SqliteTransactionChild {
    public id = '';
    public parentId = 0;
    public parent: SqliteTransactionParent | null = null;
}

class SqliteUndefinedParent {
    public id!: number;
    public name = '';
    public children: SqliteUndefinedChild[] = [];
}

class SqliteUndefinedChild {
    public id = '';
    public parentId!: number;
    public parent: SqliteUndefinedParent | null = null;
}

class SqliteOptionalUndefinedChild {
    public id = '';
    public parentId: number | null = null;
    public parent: SqliteUndefinedParent | null = null;
}

class GeneratedRelationshipSqliteContext extends DbContext {
    public parents = this.set(SqliteTransactionParent);
    public children = this.set(SqliteTransactionChild);
    public undefinedParents = this.set(SqliteUndefinedParent);
    public undefinedChildren = this.set(SqliteUndefinedChild);
    public optionalUndefinedChildren = this.set(
        SqliteOptionalUndefinedChild,
    );

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(SqliteTransactionParent, entity => {
            entity.toTable('transaction_sqlite_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().useSqliteRowId();
            entity.property(row => row.name).hasColumnType('text').isRequired();
        });
        model.entity(SqliteTransactionChild, entity => {
            entity.toTable('transaction_sqlite_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('integer').isRequired();
            entity.hasOne(SqliteTransactionParent, row => row.parent)
                .withMany(row => row.children)
                .hasForeignKey(row => row.parentId);
        });
        model.entity(SqliteUndefinedParent, entity => {
            entity.toTable('transaction_sqlite_undefined_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().useSqliteRowId();
            entity.property(row => row.name).hasColumnType('text').isRequired();
        });
        model.entity(SqliteUndefinedChild, entity => {
            entity.toTable('transaction_sqlite_undefined_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('integer').isRequired();
            entity.hasOne(SqliteUndefinedParent, row => row.parent)
                .withMany(row => row.children)
                .hasForeignKey(row => row.parentId);
        });
        model.entity(SqliteOptionalUndefinedChild, entity => {
            entity.toTable('transaction_sqlite_optional_undefined_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('integer');
            entity.hasOne(SqliteUndefinedParent, row => row.parent)
                .withMany()
                .hasForeignKey(row => row.parentId);
        });
    }
}

async function open(): Promise<GeneratedRelationshipSqliteContext> {
    const db = GeneratedRelationshipSqliteContext.create();
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: `insert into transaction_sqlite_parents (id, name)
            values (?, ?)`,
        values: [0, 'zero'],
    });
    await db.database.connection.query({
        text: `insert into transaction_sqlite_parents (id, name)
            values (?, ?)`,
        values: [2, 'existing'],
    });
    await db.database.connection.query({
        text: `insert into transaction_sqlite_children (id, parent_id)
            values (?, ?)`,
        values: ['existing-child', 2],
    });
    return db;
}

async function storedParentId(
    db: GeneratedRelationshipSqliteContext,
    childId = 'existing-child',
): Promise<number> {
    const result = await db.database.connection.query<{ parent_id: number }>({
        text: `select parent_id from transaction_sqlite_children
            where id = ?`,
        values: [childId],
    });
    return result.rows[0]?.parent_id ?? -1;
}

describe('generated relationship transactions on SQLite', () => {
    it('updates an existing child on the second save and commits', async () => {
        const db = await open();
        const child = await db.children.find('existing-child');
        if (!child) throw new Error('Expected existing child.');
        const parent = Object.assign(new SqliteTransactionParent(), {
            name: 'generated',
        });

        await db.transaction(async tx => {
            tx.parents.add(parent);
            await expect(tx.saveChanges()).resolves.toBe(1);
            expect(parent.id).toBe(3);
            child.parent = parent;
            await expect(tx.saveChanges()).resolves.toBe(1);
        });

        expect(await storedParentId(db)).toBe(3);
        expect(child.parentId).toBe(3);
        await db.dispose();
    });

    it('inserts an FK-only child after the generated principal save', async () => {
        const db = await open();
        const parent = Object.assign(new SqliteTransactionParent(), {
            name: 'generated',
        });
        const child = Object.assign(new SqliteTransactionChild(), {
            id: 'later-child',
        });

        await db.transaction(async tx => {
            tx.parents.add(parent);
            await tx.saveChanges();
            child.parentId = parent.id;
            tx.children.add(child);
            await expect(tx.saveChanges()).resolves.toBe(1);
        });

        expect(parent.id).toBe(3);
        expect(child.parent).toBe(parent);
        await db.dispose();
    });

    it('restores temporary identity and database rows on rollback', async () => {
        const db = await open();
        const child = await db.children.find('existing-child');
        if (!child) throw new Error('Expected existing child.');
        const parent = Object.assign(new SqliteTransactionParent(), {
            name: 'generated',
        });

        await expect(db.transaction(async tx => {
            tx.parents.add(parent);
            await tx.saveChanges();
            child.parent = parent;
            await tx.saveChanges();
            throw new Error('abort outer');
        })).rejects.toThrow('abort outer');

        expect(await storedParentId(db)).toBe(2);
        await expect(db.parents.count()).resolves.toBe(2);
        expect(parent.id).toBe(0);
        expect(db.entry(parent)?.state).toBe(EntityState.Added);
        expect(child.parentId).toBe(2);
        expect(db.entry(child)?.originalValues.parentId).toBe(2);
        const parentEntry = db.entry(parent);
        if (!parentEntry) throw new Error('Expected tracked parent.');
        const tracked = internalEntityEntry(parentEntry) as unknown as
            EntityEntry<object>;
        expect(activeTemporaryGeneratedIdentity(tracked)).toBeDefined();
        await db.dispose();
    });

    it('retargets an FK-only child when a rolled-back ID is reused', async () => {
        const db = await open();
        const parent = Object.assign(new SqliteTransactionParent(), {
            name: 'retried-generated-parent',
        });
        const child = Object.assign(new SqliteTransactionChild(), {
            id: 'later-child',
        });

        await expect(db.transaction(async tx => {
            tx.parents.add(parent);
            await tx.saveChanges();
            expect(parent.id).toBe(3);
            child.parentId = parent.id;
            tx.children.add(child);
            await tx.saveChanges();
            throw new Error('abort outer');
        })).rejects.toThrow('abort outer');

        expect(parent.id).toBe(0);
        expect(child).toMatchObject({ parentId: 3, parent: null });
        await db.database.connection.query({
            text: `insert into transaction_sqlite_parents (name)
                values (?)`,
            values: ['unrelated'],
        });
        const retryChild = db.getSavePlan().find(entry =>
            entry.entity === child);
        expect(retryChild?.statement.values).not.toContain(3);

        await expect(db.saveChanges()).resolves.toBe(2);

        expect(parent.id).toBe(4);
        expect(child).toMatchObject({ parentId: 4, parent });
        await expect(storedParentId(db, child.id)).resolves.toBe(4);
        await db.dispose();
    });

    it.each([
        ['required', false],
        ['optional', true],
    ] as const)(
        'requires navigation for an undefined %s FK after two rollbacks',
        async (_name, optional) => {
            const db = await open();
            const parent = Object.assign(new SqliteUndefinedParent(), {
                name: 'retried',
            });
            const child = optional
                ? Object.assign(new SqliteOptionalUndefinedChild(), {
                    id: 'optional-retried',
                })
                : Object.assign(new SqliteUndefinedChild(), {
                    id: 'required-retried',
                });
            await expect(db.transaction(async tx => {
                tx.undefinedParents.add(parent);
                await tx.saveChanges();
                child.parentId = parent.id;
                if (optional) {
                    tx.optionalUndefinedChildren.add(child);
                } else {
                    tx.undefinedChildren.add(child as SqliteUndefinedChild);
                }
                await tx.saveChanges();
                throw new Error('abort first SQLite attempt');
            })).rejects.toThrow('abort first SQLite attempt');
            await db.database.connection.query({
                text: `insert into transaction_sqlite_undefined_parents (name)
                    values (?)`,
                values: ['first blocker'],
            });
            await expect(db.transaction(async tx => {
                await tx.saveChanges();
                expect(child.parentId).toBe(2);
                throw new Error('abort second SQLite attempt');
            })).rejects.toThrow('abort second SQLite attempt');
            expect(parent.id).toBeUndefined();
            expect(child.parentId).toBeUndefined();
            await db.database.connection.query({
                text: `insert into transaction_sqlite_undefined_parents (name)
                    values (?)`,
                values: ['second blocker'],
            });
            await expect(db.saveChanges()).rejects.toThrow(
                'restored after a generated-key rollback',
            );
            child.parent = parent;
            await expect(db.saveChanges()).resolves.toBe(2);
            expect(child).toMatchObject({ parentId: 3, parent });
            const table = optional
                ? 'transaction_sqlite_optional_undefined_children'
                : 'transaction_sqlite_undefined_children';
            const result = await db.database.connection.query<{
                parent_id: number | null;
            }>({
                text: `select parent_id from ${table} where id = ?`,
                values: [child.id],
            });
            expect(result.rows[0]?.parent_id).toBe(3);
            await db.dispose();
        },
    );

    it('rejects a caller zero instead of rewriting it to a generated ID', async () => {
        const db = await open();
        const parent = Object.assign(new SqliteTransactionParent(), {
            name: 'generated',
        });
        const child = Object.assign(new SqliteTransactionChild(), {
            id: 'caller-zero',
        });
        await expect(db.transaction(async tx => {
            tx.parents.add(parent);
            await tx.saveChanges();
            child.parentId = parent.id;
            tx.children.add(child);
            await tx.saveChanges();
            throw new Error('abort caller zero setup');
        })).rejects.toThrow('abort caller zero setup');
        child.parentId = 0;
        await expect(db.parents.find(0)).resolves.toMatchObject({ id: 0 });
        await db.database.connection.query({
            text: `insert into transaction_sqlite_parents (name)
                values (?)`,
            values: ['occupy rolled-back ID'],
        });

        await expect(db.saveChanges()).rejects.toThrow(
            'ambiguous FK-only target',
        );
        expect(child).toMatchObject({ parentId: 0, parent: null });
        const stored = await db.database.connection.query<{ count: number }>({
            text: `select count(*) as count
                from transaction_sqlite_children where id = ?`,
            values: [child.id],
        });
        expect(stored.rows[0]?.count).toBe(0);
        await db.dispose();
    });
});

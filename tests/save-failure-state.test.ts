import { requireDefined } from './support/require-defined';
import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, EntityState } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';

/**
 * What a failed `saveChanges()` leaves behind.
 *
 * The tracker already preserves entity state and version numbers so a retry
 * works. Save-time writes — audit fields, tenant keys, soft-delete markers —
 * are restored for the same reason: an entity that was not persisted should
 * look exactly as the caller had it, and the *next* successful save should not
 * carry a timestamp from a failed attempt.
 */

class Doc {
    public id!: string;
    public title!: string;
    public slug!: string;
    public tenantId!: string;
    public createdAt!: Date;
    public updatedAt!: Date;
    public deletedAt!: Date | null;

    constructor(data?: Partial<Doc>) {
        Object.assign(this, data);
    }
}

class DocContext extends DbContext {
    public docs = this.set(Doc);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
        options.useTenantScope(() => 'tenant_1');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Doc, entity => {
            entity.toTable('docs');
            entity.hasKey(doc => doc.id);
            entity.tenantKey(doc => doc.tenantId);
            entity.softDelete(doc => doc.deletedAt);
            entity.audit({ createdAt: 'createdAt', updatedAt: 'updatedAt' });
            entity.property(doc => doc.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(doc => doc.title).hasColumnName('title').hasColumnType('text').isRequired();
            entity.property(doc => doc.slug).hasColumnName('slug').hasColumnType('text').isRequired().isUnique();
            entity.property(doc => doc.tenantId).hasColumnName('tenant_id').hasColumnType('text').isRequired();
            entity.property(doc => doc.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired();
            entity.property(doc => doc.updatedAt).hasColumnName('updated_at').hasColumnType('timestamptz').isRequired();
            entity.property(doc => doc.deletedAt).hasColumnName('deleted_at').hasColumnType('timestamptz');
        });
    }
}

const stamped = new Date('2026-05-01T00:00:00.000Z');

async function createDb(): Promise<DocContext> {
    const db = DocContext.create();
    await db.database.connection.query({ text: db.database.createScript(), values: [] });
    db.docs.add(new Doc({
        id: 'd1', title: 'One', slug: 'one', tenantId: 'tenant_1',
        createdAt: stamped, updatedAt: stamped, deletedAt: null,
    }));
    await db.saveChanges();
    db.changeTracker.clear();
    return db;
}

describe('state after a failed saveChanges()', () => {
    let db: DocContext;

    beforeEach(async () => {
        db = await createDb();
    });

    afterEach(async () => {
        await db.dispose();
    });

    it('restores soft-delete and audit writes after an outer rollback', async () => {
        const doc = requireDefined(await db.docs.find('d1'));
        const updatedAt = doc.updatedAt;

        await expect(db.transaction(async transaction => {
            transaction.docs.remove(doc);
            await transaction.saveChanges();
            expect(doc.deletedAt).toBeInstanceOf(Date);
            throw new Error('abort outer transaction');
        })).rejects.toThrow('abort outer transaction');

        expect(doc.deletedAt).toBeNull();
        expect(doc.updatedAt).toEqual(updatedAt);
        expect(db.entry(doc)?.state).toBe(EntityState.Deleted);
        expect(db.getSavePlan()).toHaveLength(1);
    });

    it('leaves an added entity retryable, and retries successfully', async () => {
        const conflicting = new Doc({
            id: 'd2', title: 'Two', slug: 'one', tenantId: 'tenant_1',
            createdAt: stamped, updatedAt: stamped, deletedAt: null,
        });
        db.docs.add(conflicting);

        await expect(db.saveChanges()).rejects.toThrow();
        expect(db.changeTracker.entry(conflicting)?.state).toBe(EntityState.Added);
        expect(await db.docs.count()).toBe(1);

        conflicting.slug = 'two';
        await expect(db.saveChanges()).resolves.toBe(1);
        expect(await db.docs.count()).toBe(2);
    });

    it('does not leave an audit timestamp from a save that failed', async () => {
        const doc = await db.docs.find('d1');
        requireDefined(doc).title = 'Renamed';
        requireDefined(doc).slug = 'one';
        const before = requireDefined(doc).updatedAt.getTime();

        // Fails on the unique slug of a *different* row.
        await db.database.connection.query({
            text: 'insert into "docs" ("id","title","slug","tenant_id","created_at","updated_at","deleted_at") values (?,?,?,?,?,?,null)',
            values: ['d9', 'Nine', 'taken', 'tenant_1', stamped.toISOString(), stamped.toISOString()],
        });
        requireDefined(doc).slug = 'taken';

        expect(db.getSavePlan()).toHaveLength(1);
        expect(requireDefined(doc).updatedAt.getTime()).toBe(before);
        expect(db.getSavePlanDebugView()).toContain('update "docs"');
        expect(requireDefined(doc).updatedAt.getTime()).toBe(before);

        await expect(db.saveChanges()).rejects.toThrow();

        // The row was not written, so the in-memory timestamp must not have moved.
        expect(requireDefined(doc).updatedAt.getTime()).toBe(before);
        expect(db.changeTracker.entry(requireDefined(doc))?.state).toBe(EntityState.Modified);
    });

    it('restores a failed soft delete so it can be retried', async () => {
        const doc = await db.docs.find('d1');
        db.docs.remove(requireDefined(doc));

        // Break the statement so the delete cannot be applied.
        await db.database.connection.query({ text: 'drop table "docs"', values: [] });
        await expect(db.saveChanges()).rejects.toThrow();

        // deletedAt was stamped while preparing the save and must be undone.
        expect(requireDefined(doc).deletedAt).toBeNull();
        expect(db.changeTracker.entry(requireDefined(doc))?.state).toBe(EntityState.Deleted);

        // Recreate the row after the forced infrastructure failure. The pending
        // delete must still be present and succeed without another remove() call.
        await db.database.connection.query({ text: db.database.createScript(), values: [] });
        await db.database.connection.query({
            text: 'insert into "docs" ("id","title","slug","tenant_id","created_at","updated_at","deleted_at") values (?,?,?,?,?,?,null)',
            values: ['d1', 'One', 'one', 'tenant_1', stamped.toISOString(), stamped.toISOString()],
        });

        await expect(db.saveChanges()).resolves.toBe(1);
        db.changeTracker.clear();
        const deleted = await db.docs
            .ignoreQueryFilters()
            .where(row => row.id.eq('d1'))
            .single();
        expect(deleted.deletedAt).toBeInstanceOf(Date);
    });

    it('restores a soft delete when plan construction fails, then retries', async () => {
        const doc = await db.docs.find('d1');
        requireDefined(doc).id = 'changed';
        db.docs.remove(requireDefined(doc));

        await expect(db.saveChanges()).rejects.toThrow(
            'Primary key changes are not supported',
        );

        expect(requireDefined(doc).deletedAt).toBeNull();
        expect(db.changeTracker.entry(requireDefined(doc))?.state).toBe(EntityState.Deleted);
        expect(await db.docs.ignoreQueryFilters().count()).toBe(1);

        requireDefined(doc).id = 'd1';
        await expect(db.saveChanges()).resolves.toBe(1);
        expect(requireDefined(doc).deletedAt).toBeInstanceOf(Date);
    });

    it('retains tenant identity assigned by add when a later save fails', async () => {
        const orphan = new Doc({
            id: 'd3', title: 'Three', slug: 'three',
            createdAt: stamped, updatedAt: stamped, deletedAt: null,
        });
        (orphan as Partial<Doc>).tenantId = undefined;
        db.docs.add(orphan);
        expect(orphan.tenantId).toBe('tenant_1');

        await db.database.connection.query({ text: 'drop table "docs"', values: [] });
        await expect(db.saveChanges()).rejects.toThrow();

        expect(orphan.tenantId).toBe('tenant_1');
        expect(db.entry(orphan)?.state).toBe(EntityState.Added);
    });
});

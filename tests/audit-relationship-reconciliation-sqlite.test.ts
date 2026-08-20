import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, EntityState } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import type { ChangeTracker } from '../packages/core/src/tracking/change-tracker';
import { SaveTimeMutationLog } from '../packages/core/src/core/save-time-mutations';
import { RestorationScope } from '../packages/core/src/restoration-scope';
import { reconcileSaveTimeRelationships } from '../packages/core/src/core/save-time-relationship-reconciliation';
import { internalChangeTracker } from './support/public-api-internals';

class AuditActor {
    public id = '';
    public documents: AuditedDocument[] = [];
}

class AuditedDocument {
    public id = '';
    public title = '';
    public updatedById: string | null = null;
    public updatedBy: AuditActor | null = null;
}

class AuditRelationshipContext extends DbContext {
    public actors = this.set(AuditActor);
    public documents = this.set(AuditedDocument);

    constructor(private currentActorId: string | undefined) {
        super();
    }

    public useActor(actorId: string | undefined): void {
        this.currentActorId = actorId;
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:')
            .useAuditing({ currentUserId: () => this.currentActorId });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(AuditActor, entity => {
            entity.toTable('audit_actors');
            entity.hasKey(actor => actor.id);
            entity.property(actor => actor.id).hasColumnType('text').isRequired();
        });
        model.entity(AuditedDocument, entity => {
            entity.toTable('audited_documents');
            entity.hasKey(document => document.id);
            entity.audit({ updatedBy: document => document.updatedById });
            entity.property(document => document.id).hasColumnType('text')
                .isRequired();
            entity.property(document => document.title).hasColumnType('text')
                .isRequired();
            entity.property(document => document.updatedById)
                .hasColumnName('updated_by_id').hasColumnType('text')
                .isOptional();
            entity.hasOne(AuditActor, document => document.updatedBy)
                .withMany(actor => actor.documents)
                .hasForeignKey(document => document.updatedById);
        });
    }
}

async function open(currentActorId: string): Promise<AuditRelationshipContext> {
    const db = AuditRelationshipContext.create(currentActorId);
    await db.database.connection.query({
        text: db.database.createScript(),
        values: [],
    });
    await db.database.connection.query({
        text: 'insert into audit_actors (id) values (?), (?)',
        values: ['actor-a', 'actor-b'],
    });
    await db.database.connection.query({
        text: `insert into audited_documents (id, title, updated_by_id)
            values (?, ?, ?)`,
        values: ['document', 'before', 'actor-a'],
    });
    return db;
}

function trackedGraph(db: AuditRelationshipContext): {
    readonly actorA: AuditActor;
    readonly actorB: AuditActor;
    readonly document: AuditedDocument;
} {
    const actorA = Object.assign(new AuditActor(), { id: 'actor-a' });
    const actorB = Object.assign(new AuditActor(), { id: 'actor-b' });
    const document = Object.assign(new AuditedDocument(), {
        id: 'document',
        title: 'before',
        updatedById: actorA.id,
        updatedBy: actorA,
    });
    actorA.documents = [document];
    db.actors.attach(actorA);
    db.actors.attach(actorB);
    db.documents.attach(document);
    return { actorA, actorB, document };
}

function reconcileForTest(
    db: AuditRelationshipContext,
    action: () => void,
): {
    readonly changed: ReadonlyMap<object, ReadonlySet<string>>;
    readonly mutations: SaveTimeMutationLog;
} {
    const tracked = internalChangeTracker(db.changeTracker);
    const detect: ChangeTracker['detectSaveRelationships'] = (
        _entries,
        _values,
        refreshBaselines,
        _restoration,
        beforeCommit,
    ) => {
        expect(refreshBaselines).toBe(false);
        action();
        beforeCommit?.();
    };
    const tracker = {
        entries: () => tracked.entries(),
        detectSaveRelationships: detect,
    } as unknown as ChangeTracker;
    const mutations = new SaveTimeMutationLog();
    const changed = reconcileSaveTimeRelationships(
        tracker,
        mutations,
        new RestorationScope(() => undefined),
        tracked.entries(),
    );
    return { changed, mutations };
}

describe('audit relationship reconciliation', () => {
    it('does not journal unchanged navigations during reconciliation', async () => {
        const db = await open('actor-b');
        trackedGraph(db);

        const result = reconcileForTest(db, () => undefined);

        expect(result.changed.size).toBe(0);
        await db.dispose();
    });

    it('restores scalar and collection navigation writes exactly', async () => {
        const db = await open('actor-b');
        const { actorA, actorB, document } = trackedGraph(db);
        const actorADocuments = actorA.documents;
        const actorBDocuments = actorB.documents;
        const result = reconcileForTest(db, () => {
            actorA.documents.splice(0, actorA.documents.length);
            actorB.documents.push(document);
            document.updatedBy = actorB;
        });

        expect(result.changed.get(actorA)).toEqual(new Set(['documents']));
        expect(result.changed.get(actorB)).toEqual(new Set(['documents']));
        expect(result.changed.get(document)).toEqual(new Set(['updatedBy']));
        result.mutations.restore();
        expect(actorA.documents).toBe(actorADocuments);
        expect(actorA.documents).toEqual([document]);
        expect(actorB.documents).toBe(actorBDocuments);
        expect(actorB.documents).toEqual([]);
        expect(document.updatedBy).toBe(actorA);
        await db.dispose();
    });

    it('preserves an application navigation overwrite during rollback', async () => {
        const db = await open('actor-b');
        const { actorB, document } = trackedGraph(db);
        const result = reconcileForTest(db, () => {
            document.updatedBy = actorB;
        });
        document.updatedBy = null;

        result.mutations.restore();

        expect(document.updatedBy).toBeNull();
        await db.dispose();
    });

    it('fixes the tracked reference and inverse collections after an audit FK write', async () => {
        const db = await open('actor-b');
        const { actorA, actorB, document } = trackedGraph(db);
        document.title = 'after';

        await expect(db.saveChanges()).resolves.toBe(1);

        expect(document.updatedById).toBe('actor-b');
        expect(document.updatedBy).toBe(actorB);
        expect(actorA.documents).toEqual([]);
        expect(actorB.documents).toEqual([document]);
        expect(db.entry(document)?.state).toBe(EntityState.Unchanged);
        const stored = await db.database.connection.query<{
            updated_by_id: string;
        }>({
            text: 'select updated_by_id from audited_documents where id = ?',
            values: ['document'],
        });
        expect(stored.rows).toEqual([{ updated_by_id: 'actor-b' }]);
        await db.dispose();
    });

    it('clears a stale reference when the audit principal is not tracked', async () => {
        const db = await open('actor-b');
        const { actorA, actorB, document } = trackedGraph(db);
        db.actors.detach(actorB);
        document.title = 'after';

        await expect(db.saveChanges()).resolves.toBe(1);

        expect(document.updatedById).toBe('actor-b');
        expect(document.updatedBy).toBeNull();
        expect(actorA.documents).toEqual([]);
        await db.dispose();
    });

    it('accepts every inverse baseline changed by audit reconciliation', async () => {
        const db = await open('actor-b');
        const { actorB, document } = trackedGraph(db);
        document.title = 'after';
        await db.saveChanges();
        db.useActor(undefined);

        actorB.documents = [];

        await expect(db.saveChanges()).resolves.toBe(1);
        expect(document.updatedById).toBeNull();
        expect(document.updatedBy).toBeNull();
        const stored = await db.database.connection.query<{
            updated_by_id: string | null;
        }>({
            text: 'select updated_by_id from audited_documents where id = ?',
            values: ['document'],
        });
        expect(stored.rows).toEqual([{ updated_by_id: null }]);
        await db.dispose();
    });

    it('restores relationship fix-up when an audit FK save fails', async () => {
        const db = await open('missing-actor');
        const { actorA, actorB, document } = trackedGraph(db);
        db.actors.detach(actorB);
        document.title = 'after';

        await expect(db.saveChanges()).rejects.toThrow();

        expect(document.updatedById).toBe('actor-a');
        expect(document.updatedBy).toBe(actorA);
        expect(actorA.documents).toEqual([document]);
        expect(db.entry(document)?.state).toBe(EntityState.Modified);
        await db.dispose();
    });
});

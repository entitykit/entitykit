import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, EntityState } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

class AuditActor {
    public id = '';
    public documents: AuditedDocument[] = [];
}

class AuditedDocument {
    public id = '';
    public title = '';
    public updatedById = '';
    public updatedBy: AuditActor | null = null;
}

class AuditRelationshipContext extends DbContext {
    public actors = this.set(AuditActor);
    public documents = this.set(AuditedDocument);

    constructor(private readonly currentActorId: string) {
        super();
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
                .isRequired();
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

describe('audit relationship reconciliation', () => {
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

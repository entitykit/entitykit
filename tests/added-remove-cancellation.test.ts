import type {
    DbContextOptionsBuilder,
    ModelBuilder,
} from '../src';
import {
    DbContext,
    EntityState,
} from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import { RecordingDatabaseConnection } from '../src/testing';

interface DomainEvent {
    readonly type: string;
    readonly payload: Record<string, unknown>;
}

class PlainItem {
    public id!: string;
    public name!: string;
    public domainEvents: DomainEvent[] = [];
}

class SoftItem {
    public id!: string;
    public name!: string;
    public deletedAt!: Date | null;
    public domainEvents: DomainEvent[] = [];
}

class CancelPost {
    public id!: string;
    public title!: string;
    public tags: CancelTag[] = [];
}

class CancelTag {
    public id!: string;
    public name!: string;
    public posts: CancelPost[] = [];
}

function useOutbox(options: DbContextOptionsBuilder): void {
    options.useOutbox({
        tableName: 'app_outbox',
        collectEvents: entity =>
            'domainEvents' in entity
                ? (entity as PlainItem | SoftItem).domainEvents
                : [],
        clearEvents: (entity, persistedEvents) => {
            if ('domainEvents' in entity) {
                const persisted = new Set(persistedEvents);
                const item = entity as PlainItem | SoftItem;
                item.domainEvents = item.domainEvents.filter(
                    event => !persisted.has(event),
                );
            }
        },
    });
}

abstract class CancellationModelContext extends DbContext {
    public plainItems = this.set(PlainItem);
    public softItems = this.set(SoftItem);
    public posts = this.set(CancelPost);
    public tags = this.set(CancelTag);

    protected override model(model: ModelBuilder): void {
        model.entity(PlainItem, entity => {
            entity.toTable('plain_items');
            entity.hasKey(item => item.id);
            entity.property(item => item.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(item => item.name).hasColumnName('name').hasColumnType('text').isRequired();
            entity.ignore(item => item.domainEvents);
        });
        model.entity(SoftItem, entity => {
            entity.toTable('soft_items');
            entity.hasKey(item => item.id);
            entity.softDelete(item => item.deletedAt);
            entity.property(item => item.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(item => item.name).hasColumnName('name').hasColumnType('text').isRequired();
            entity.property(item => item.deletedAt).hasColumnName('deleted_at').hasColumnType('timestamptz');
            entity.ignore(item => item.domainEvents);
        });
        model.entity(CancelPost, entity => {
            entity.toTable('cancel_posts');
            entity.hasKey(post => post.id);
            entity.property(post => post.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(post => post.title).hasColumnName('title').hasColumnType('text').isRequired();
            entity.hasManyToMany(CancelTag, post => post.tags)
                .withMany(tag => tag.posts)
                .usingJoinTable('cancel_post_tags', join => {
                    join.sourceForeignKey('cancel_post_id');
                    join.targetForeignKey('cancel_tag_id');
                });
        });
        model.entity(CancelTag, entity => {
            entity.toTable('cancel_tags');
            entity.hasKey(tag => tag.id);
            entity.property(tag => tag.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(tag => tag.name).hasColumnName('name').hasColumnType('text').isRequired();
        });
    }
}

let recordingConnection: RecordingDatabaseConnection;

class RecordingCancellationContext extends CancellationModelContext {
    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(recordingConnection);
        useOutbox(options);
    }
}

class SqliteCancellationContext extends CancellationModelContext {
    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
        useOutbox(options);
    }
}

function openRecording(): RecordingCancellationContext {
    recordingConnection = new RecordingDatabaseConnection();
    return RecordingCancellationContext.create();
}

async function openSqlite(): Promise<SqliteCancellationContext> {
    const db =  SqliteCancellationContext.create();
    await db.database.connection.query({ text: db.database.createScript(), values: [] });
    await db.database.connection.query({
        text: 'create table app_outbox (type text, payload text, aggregate_id text, occurred_at text)',
        values: [],
    });
    return db;
}

describe('Added then removed entities cancel their pending work', () => {
    it('detaches a normal entity and skips its insert and outbox event', async () => {
        const db =  openRecording();
        const item = Object.assign(new PlainItem(), {
            id: 'plain_1',
            name: 'temporary',
            domainEvents: [{ type: 'PlainCreated', payload: { id: 'plain_1' } }],
        });
        db.plainItems.add(item);

        const removed = db.plainItems.remove(item);

        expect(removed.state).toBe(EntityState.Detached);
        expect(db.entry(item)).toBeUndefined();
        await expect(db.saveChanges()).resolves.toBe(0);
        expect(recordingConnection.statements).toEqual([]);
        expect(recordingConnection.transactionEvents).toEqual([]);
        expect(item.domainEvents).toHaveLength(1);
    });

    it('detaches a soft-delete entity without stamping or updating it', async () => {
        const db =  openRecording();
        const item = Object.assign(new SoftItem(), {
            id: 'soft_1',
            name: 'temporary',
            deletedAt: null,
        });
        db.softItems.add(item);

        const removed = db.softItems.remove(item);

        expect(removed.state).toBe(EntityState.Detached);
        await expect(db.saveChanges()).resolves.toBe(0);
        expect(item.deletedAt).toBeNull();
        expect(recordingConnection.statements).toEqual([]);
    });

    it('drops only queued many-to-many work involving the canceled entity', async () => {
        const db =  openRecording();
        const tag = Object.assign(new CancelTag(), { id: 'tag_1', name: 'Tag' });
        const kept = Object.assign(new CancelPost(), {
            id: 'post_kept',
            title: 'Kept',
        });
        const canceled = Object.assign(new CancelPost(), {
            id: 'post_canceled',
            title: 'Canceled',
        });
        const canceledTag = Object.assign(new CancelTag(), {
            id: 'tag_canceled',
            name: 'Canceled',
        });
        db.tags.attach(tag);
        db.posts.attach(kept);
        db.posts.add(canceled);
        db.tags.add(canceledTag);
        db.link(kept, post => post.tags, tag);
        db.link(canceled, post => post.tags, tag);
        db.link(kept, post => post.tags, canceledTag);
        db.posts.remove(canceled);
        db.tags.remove(canceledTag);
        recordingConnection.queueResult({ rowCount: 1 });

        await expect(db.saveChanges()).resolves.toBe(0);

        expect(recordingConnection.statements).toEqual([{
            text: 'insert into "cancel_post_tags" ("cancel_post_id", "cancel_tag_id") values ($1, $2) on conflict do nothing',
            values: ['post_kept', 'tag_1'],
        }]);
        // Cancellation removes persistence work, not caller-owned object graph data.
        expect(canceled.tags).toEqual([tag]);
        expect(kept.tags).toEqual([tag, canceledTag]);
    });

    it('persists nothing for canceled entities against real SQLite', async () => {
        const db = await openSqlite();
        const tag = Object.assign(new CancelTag(), { id: 'tag_1', name: 'Tag' });
        db.tags.add(tag);
        await db.saveChanges();

        const plain = Object.assign(new PlainItem(), {
            id: 'plain_1',
            name: 'temporary',
            domainEvents: [{ type: 'PlainCreated', payload: { id: 'plain_1' } }],
        });
        const soft = Object.assign(new SoftItem(), {
            id: 'soft_1',
            name: 'temporary',
            deletedAt: null,
        });
        const post = Object.assign(new CancelPost(), {
            id: 'post_1',
            title: 'temporary',
        });
        db.plainItems.add(plain);
        db.softItems.add(soft);
        db.posts.add(post);
        db.link(post, item => item.tags, tag);
        db.plainItems.remove(plain);
        db.softItems.remove(soft);
        db.posts.remove(post);

        await expect(db.saveChanges()).resolves.toBe(0);

        for (const table of [
            'plain_items',
            'soft_items',
            'cancel_posts',
            'cancel_post_tags',
            'app_outbox',
        ]) {
            const result = await db.database.connection.query<{ count: number }>({
                text: `select count(*) as count from "${table}"`,
                values: [],
            });
            expect(result.rows[0]?.count).toBe(0);
        }
        expect(soft.deletedAt).toBeNull();
        expect(plain.domainEvents).toHaveLength(1);
        await db.dispose();
    });
});

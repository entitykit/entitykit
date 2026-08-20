import type { DbContextOptionsBuilder } from '../packages/core/src';
import { DbContext, EntityState, type ModelBuilder } from '../packages/core/src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class SaaSUser {
    public id!: string;
    public workspaceId!: string;
    public email!: string;
    public posts!: SaaSPost[];
    public createdAt?: Date;
    public updatedAt?: Date;
    public createdBy?: string;
    public updatedBy?: string;
    public deletedAt?: Date | null;

    constructor(data?: Partial<SaaSUser>) {
        Object.assign(this, data);
    }
}

class SaaSPost {
    public id!: string;
    public workspaceId!: string;
    public authorId!: string;
    public title!: string;
    public tags!: SaaSTag[];
    public deletedAt?: Date | null;
    public author?: SaaSUser;
}

class SaaSTag {
    public id!: string;
    public workspaceId!: string;
    public name!: string;
    public posts!: SaaSPost[];
    public deletedAt?: Date | null;
}

class SaaSContext extends DbContext {
    public users = this.set(SaaSUser);
    public posts = this.set(SaaSPost);
    public tags = this.set(SaaSTag);

    constructor(
        private readonly connection: RecordingDatabaseConnection,
        private readonly now: Date,
        private readonly tenantId = 'wrk_1',
    ) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options
            .useConnection(this.connection)
            .useAuditing({ now: () => this.now, currentUserId: () => 'actor_1' })
            .useTenantScope(() => this.tenantId);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(SaaSUser, entity => {
            entity.toTable('users');
            entity.hasKey(user => user.id);
            entity.tenantKey(user => user.workspaceId);
            entity.softDelete(user => user.deletedAt);
            entity.audit({
                createdAt: user => user.createdAt,
                updatedAt: user => user.updatedAt,
                createdBy: user => user.createdBy,
                updatedBy: user => user.updatedBy,
            });

            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(user => user.workspaceId).hasColumnName('workspace_id').hasColumnType('text').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
            entity.property(user => user.createdAt).hasColumnName('created_at').hasColumnType('timestamptz');
            entity.property(user => user.updatedAt).hasColumnName('updated_at').hasColumnType('timestamptz');
            entity.property(user => user.createdBy).hasColumnName('created_by').hasColumnType('text');
            entity.property(user => user.updatedBy).hasColumnName('updated_by').hasColumnType('text');
            entity.property(user => user.deletedAt).hasColumnName('deleted_at').hasColumnType('timestamptz');
        });

        model.entity(SaaSPost, entity => {
            entity.toTable('posts');
            entity.hasKey(post => post.id);
            entity.tenantKey(post => post.workspaceId);
            entity.softDelete(post => post.deletedAt);
            entity.property(post => post.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(post => post.workspaceId).hasColumnName('workspace_id').hasColumnType('text').isRequired();
            entity.property(post => post.authorId).hasColumnName('author_id').hasColumnType('text').isRequired();
            entity.property(post => post.title).hasColumnName('title').hasColumnType('text').isRequired();
            entity.property(post => post.deletedAt).hasColumnName('deleted_at').hasColumnType('timestamptz');
            entity.hasOne(SaaSUser, post => post.author).withMany(user => user.posts).hasForeignKey(post => post.authorId);
            entity.hasManyToMany(SaaSTag, post => post.tags)
                .withMany(tag => tag.posts)
                .usingJoinTable('post_tags', join => {
                    join.sourceForeignKey('post_id');
                    join.targetForeignKey('tag_id');
                });
        });

        model.entity(SaaSTag, entity => {
            entity.toTable('tags');
            entity.hasKey(tag => tag.id);
            entity.tenantKey(tag => tag.workspaceId);
            entity.softDelete(tag => tag.deletedAt);
            entity.property(tag => tag.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(tag => tag.workspaceId).hasColumnName('workspace_id').hasColumnType('text').isRequired();
            entity.property(tag => tag.name).hasColumnName('name').hasColumnType('text').isRequired();
            entity.property(tag => tag.deletedAt).hasColumnName('deleted_at').hasColumnType('timestamptz');
        });
    }

    public static createWith(connection: RecordingDatabaseConnection, now: Date, tenantId = 'wrk_1'): SaaSContext {
        const context = SaaSContext.create(connection, now, tenantId);
        return context;
    }
}

describe('SaaS primitives', () => {
    it('populates audit fields and tenant keys before insert', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        const now = new Date('2026-06-01T12:00:00.000Z');
        const db =  SaaSContext.createWith(connection, now);
        const user = new SaaSUser({ id: 'usr_1', email: 'a@example.com', deletedAt: null });

        db.users.add(user);
        await db.saveChanges();

        expect(user.workspaceId).toBe('wrk_1');
        expect(user.createdAt).toEqual(now);
        expect(user.updatedAt).toEqual(now);
        expect(user.createdBy).toBe('actor_1');
        expect(user.updatedBy).toBe('actor_1');
        expect(connection.statements[0]?.text).toContain('insert into "users"');
        expect(connection.statements[0]?.values).toContain('wrk_1');
        expect(connection.statements[0]?.values).toContain('actor_1');
        expect(db.entry(user)?.state).toBe(EntityState.Unchanged);
    });

    it('converts remove into a soft delete update', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        const now = new Date('2026-06-01T12:00:00.000Z');
        const db =  SaaSContext.createWith(connection, now);
        const user = new SaaSUser({ id: 'usr_1', workspaceId: 'wrk_1', email: 'a@example.com', deletedAt: null });

        db.users.attach(user);
        db.users.remove(user);
        await db.saveChanges();

        expect(user.deletedAt).toEqual(now);
        expect(connection.statements[0]?.text).toContain('update "users" set');
        expect(connection.statements[0]?.text).toContain('"deleted_at" = $1');
        expect(connection.statements[0]?.text).not.toContain('delete from');
        expect(db.entry(user)?.state).toBe(EntityState.Unchanged);
    });

    it('applies soft delete and tenant query filters by default', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [], rowCount: 0 });
        const db =  SaaSContext.createWith(connection, new Date('2026-06-01T12:00:00.000Z'));

        await db.users.where(user => user.email.like('%@example.com')).toArray();

        expect(connection.statements[0]?.text).toContain('"email" like $1');
        expect(connection.statements[0]?.text).toContain('"deleted_at" is null');
        expect(connection.statements[0]?.text).toContain('"workspace_id" = $2');
        expect(connection.statements[0]?.values).toEqual(['%@example.com', 'wrk_1']);
    });

    it('includes global query filters in SQL previews', () => {
        const db =  SaaSContext.createWith(new RecordingDatabaseConnection(), new Date('2026-06-01T12:00:00.000Z'));

        const preview = db.users.where(user => user.email.like('%@example.com')).toSql();

        expect(preview.text).toContain('"email" like $1');
        expect(preview.text).toContain('"deleted_at" is null');
        expect(preview.text).toContain('"workspace_id" = $2');
        expect(preview.values).toEqual(['%@example.com', 'wrk_1']);
    });

    it('ignores soft delete but keeps tenant scope for administrative queries', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [], rowCount: 0 });
        const db =  SaaSContext.createWith(connection, new Date('2026-06-01T12:00:00.000Z'));

        await db.users.ignoreQueryFilters().where(user => user.email.like('%@example.com')).toArray();

        expect(connection.statements[0]?.text).toContain('"email" like $1');
        expect(connection.statements[0]?.text).not.toContain('"deleted_at" is null');
        // Deliberate: an administrative query within a workspace is still that
        // workspace's query. Crossing tenants takes its own verb.
        expect(connection.statements[0]?.text).toContain('"workspace_id" =');
    });

    it('crosses tenants only through ignoreTenantScope', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [], rowCount: 0 });
        const db =  SaaSContext.createWith(connection, new Date('2026-06-01T12:00:00.000Z'));

        await db.users.ignoreTenantScope().where(user => user.email.like('%@example.com')).toArray();

        expect(connection.statements[0]?.text).not.toContain('"workspace_id" =');
        // Soft delete is a separate opt-out, so deleted rows stay hidden.
        expect(connection.statements[0]?.text).toContain('"deleted_at" is null');
    });

    it('drops every implicit filter when both opt-outs are combined', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [], rowCount: 0 });
        const db =  SaaSContext.createWith(connection, new Date('2026-06-01T12:00:00.000Z'));

        await db.users.ignoreQueryFilters().ignoreTenantScope().where(user => user.email.like('%@example.com')).toArray();

        expect(connection.statements[0]?.text).not.toContain('"deleted_at" is null');
        expect(connection.statements[0]?.text).not.toContain('"workspace_id" =');
        expect(connection.statements[0]?.values).toEqual(['%@example.com']);
    });

    it('applies query filters inside relation existence subqueries', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [], rowCount: 0 });
        const db =  SaaSContext.createWith(connection, new Date('2026-06-01T12:00:00.000Z'));

        await db.users
            .whereHas(user => user.posts, post => post.title.contains('launch'))
            .toArray();

        expect(connection.statements[0]?.text).toContain('from "users" "root"');
        expect(connection.statements[0]?.text).toContain('exists(select 1 from "posts" "rel" where "rel"."author_id" = "root"."id"');
        expect(connection.statements[0]?.text).toContain('"root"."deleted_at" is null');
        expect(connection.statements[0]?.text).toContain('"root"."workspace_id" = $1');
        expect(connection.statements[0]?.text).toContain('"rel"."title" like $2');
        expect(connection.statements[0]?.text).toContain('"rel"."deleted_at" is null');
        expect(connection.statements[0]?.text).toContain('"rel"."workspace_id" = $3');
        expect(connection.statements[0]?.values).toEqual(['wrk_1', '%launch%', 'wrk_1']);
    });

    it('can suppress relation existence query filters for administrative queries', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [], rowCount: 0 });
        const db =  SaaSContext.createWith(connection, new Date('2026-06-01T12:00:00.000Z'));

        await db.users
            .ignoreQueryFilters()
            .ignoreTenantScope()
            .whereHas(user => user.posts, post => post.title.contains('launch'))
            .toArray();

        expect(connection.statements[0]?.text).toContain('exists(select 1 from "posts" "rel" where "rel"."author_id" = "root"."id" and "rel"."title" like $1 escape \'~\')');
        expect(connection.statements[0]?.text).not.toContain('"root"."deleted_at" is null');
        expect(connection.statements[0]?.text).not.toContain('"root"."workspace_id" =');
        expect(connection.statements[0]?.text).not.toContain('"rel"."deleted_at" is null');
        expect(connection.statements[0]?.text).not.toContain('"rel"."workspace_id" =');
        expect(connection.statements[0]?.values).toEqual(['%launch%']);
    });

    it('applies query filters inside many-to-many relation existence subqueries', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [], rowCount: 0 });
        const db =  SaaSContext.createWith(connection, new Date('2026-06-01T12:00:00.000Z'));

        await db.posts
            .whereHas(post => post.tags, tag => tag.name.eq('launch'))
            .toArray();

        expect(connection.statements[0]?.text).toContain('from "posts" "root"');
        expect(connection.statements[0]?.text).toContain('exists(select 1 from "post_tags" "rel_join" join "tags" "rel" on "rel_join"."tag_id" = "rel"."id" where "rel_join"."post_id" = "root"."id"');
        expect(connection.statements[0]?.text).toContain('"root"."deleted_at" is null');
        expect(connection.statements[0]?.text).toContain('"root"."workspace_id" = $1');
        expect(connection.statements[0]?.text).toContain('"rel"."name" = $2');
        expect(connection.statements[0]?.text).toContain('"rel"."deleted_at" is null');
        expect(connection.statements[0]?.text).toContain('"rel"."workspace_id" = $3');
        expect(connection.statements[0]?.values).toEqual(['wrk_1', 'launch', 'wrk_1']);
    });

    it('resolves inverse many-to-many relation existence through DbSet', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [], rowCount: 0 });
        const db =  SaaSContext.createWith(connection, new Date('2026-06-01T12:00:00.000Z'));

        await db.tags
            .whereDoesNotHave(tag => tag.posts, post => post.title.contains('draft'))
            .toArray();

        expect(connection.statements[0]?.text).toContain('not exists(select 1 from "post_tags" "rel_join" join "posts" "rel" on "rel_join"."post_id" = "rel"."id" where "rel_join"."tag_id" = "root"."id"');
        expect(connection.statements[0]?.text).toContain('"rel"."title" like $2');
        expect(connection.statements[0]?.text).toContain('"rel"."deleted_at" is null');
        expect(connection.statements[0]?.text).toContain('"rel"."workspace_id" = $3');
        expect(connection.statements[0]?.values).toEqual(['wrk_1', '%draft%', 'wrk_1']);
    });

    it('rejects adds outside the current tenant scope', () => {
        const connection = new RecordingDatabaseConnection();
        const db =  SaaSContext.createWith(connection, new Date('2026-06-01T12:00:00.000Z'));
        const user = new SaaSUser({
            id: 'usr_1',
            workspaceId: 'wrk_2',
            email: 'a@example.com',
        });

        expect(() => db.users.add(user)).toThrow('must match the current tenant scope');
        expect(db.entry(user)).toBeUndefined();
        expect(connection.statements).toHaveLength(0);
    });
});

import { requireDefined } from '../support/require-defined';
import type {
    DbContextOptionsBuilder,
    ModelBuilder,
} from '../../packages/core/src';
import {
    DbContext,
    DbUpdateConcurrencyError,
    EntityState,
} from '../../packages/core/src';

const shouldRunPostgresTests = process.env.RUN_POSTGRES_TESTS === 'true' && Boolean(process.env.DATABASE_URL);
const describePostgres = shouldRunPostgresTests ? describe : describe.skip;

class VersionedUser {
    public id!: string;
    public email!: string;
    public name!: string;
    public version!: number;
    public updatedAt!: Date;

    constructor(data?: Partial<VersionedUser>) {
        Object.assign(this, data);
    }
}

class ConcurrencyDbContext extends DbContext {
    public users = this.set(VersionedUser);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.usePostgres(requireDefined(process.env.DATABASE_URL));
    }

    protected override model(model: ModelBuilder): void {
        model.entity(VersionedUser, entity => {
            entity.toTable('entitykit_concurrency_users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
            entity.property(user => user.name).hasColumnName('name').hasColumnType('text').isRequired();
            entity.property(user => user.version).hasColumnName('version').hasColumnType('integer').isRequired().isVersion();
            entity.property(user => user.updatedAt).hasColumnName('updated_at').hasColumnType('timestamptz').isRequired().isConcurrencyToken();
        });
    }
}

describePostgres('Postgres optimistic concurrency integration', () => {
    let db: ConcurrencyDbContext;

    beforeEach(async () => {
        db =  ConcurrencyDbContext.create();
        await db.database.connection.query({ text: 'drop table if exists "entitykit_concurrency_users" cascade', values: [] });
        await db.database.connection.query({ text: db.database.createScript(), values: [] });
    });

    afterEach(async () => {
        await db.dispose();
    });

    it('throws a typed concurrency error when an update loses the version race', async () => {
        const now = new Date('2026-01-01T00:00:00.000Z');
        db.users.add(new VersionedUser({
            id: 'usr_update',
            email: 'update@example.com',
            name: 'Original',
            version: 1,
            updatedAt: now,
        }));
        await db.saveChanges();
        db.changeTracker.clear();

        const user = await db.users.find('usr_update');
        expect(user).toBeInstanceOf(VersionedUser);
        expect(db.entry(requireDefined(user))?.state).toBe(EntityState.Unchanged);

        await db.database.connection.query({
            text: 'update "entitykit_concurrency_users" set "name" = $1, "version" = "version" + 1 where "id" = $2',
            values: ['External', 'usr_update'],
        });

        requireDefined(user).name = 'Local';
        await expect(db.saveChanges()).rejects.toBeInstanceOf(DbUpdateConcurrencyError);
    });

    it('throws a typed concurrency error when a deleted entity was already removed', async () => {
        const now = new Date('2026-01-01T00:00:00.000Z');
        db.users.add(new VersionedUser({
            id: 'usr_delete',
            email: 'delete@example.com',
            name: 'Original',
            version: 1,
            updatedAt: now,
        }));
        await db.saveChanges();
        db.changeTracker.clear();

        const user = await db.users.find('usr_delete');
        await db.database.connection.query({
            text: 'delete from "entitykit_concurrency_users" where "id" = $1',
            values: ['usr_delete'],
        });

        db.users.remove(requireDefined(user));
        await expect(db.saveChanges()).rejects.toBeInstanceOf(DbUpdateConcurrencyError);
    });
});

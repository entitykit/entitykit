import type {
    DbContextOptionsBuilder,
    ModelBuilder,
} from '../src';
import { DbContext, EntityState } from '../src';
import { RecordingDatabaseConnection } from '../src/testing';

class ScopedUser {
    public id!: string;
    public tenantId!: string;
    public createdBy?: string;
    public createdAt?: Date;
}

class ScopedContext extends DbContext {
    public users = this.set(ScopedUser);

    constructor(
        private readonly connection: RecordingDatabaseConnection,
        private readonly configureValues: (
            options: DbContextOptionsBuilder,
        ) => void,
    ) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection);
        this.configureValues(options);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(ScopedUser, entity => {
            entity.toTable('scoped_users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnType('text');
            entity.property(user => user.tenantId).hasColumnType('text');
            entity.property(user => user.createdBy).hasColumnType('text');
            entity.tenantKey(user => user.tenantId);
            entity.audit({
                createdBy: user => user.createdBy,
                createdAt: user => user.createdAt,
            });
            entity.property(user => user.createdAt).hasColumnType('timestamptz');
        });
    }
}

describe('synchronous scoped value providers', () => {
    it('rejects an asynchronous tenant provider before querying', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = ScopedContext.create(connection, options => {
            options.useTenantScope(async () => {
                await Promise.resolve();
                return 'tenant-1';
            });
        });

        await expect(db.users.toArray()).rejects.toThrow(
            'The current tenant callback must be synchronous and must not return a Promise.',
        );
        expect(connection.statements).toEqual([]);
    });

    it('rejects an asynchronous audit-user provider before saving', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = ScopedContext.create(connection, options => {
            options.useTenantScope(() => 'tenant-1');
            options.useAuditing({
                currentUserId: async () => {
                    await Promise.resolve();
                    return 'user-1';
                },
            });
        });
        db.users.add(Object.assign(new ScopedUser(), {
            id: 'user-1',
            tenantId: 'tenant-1',
        }));

        await expect(db.saveChanges()).rejects.toThrow(
            'The current audit user callback must be synchronous and must not return a Promise.',
        );
        expect(connection.statements).toEqual([]);
    });

    it('rejects an asynchronous audit clock before saving', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = ScopedContext.create(connection, options => {
            options.useTenantScope(() => 'tenant-1');
            options.useAuditing({
                now: (async () => {
                    await Promise.resolve();
                    return new Date('2026-08-04T12:00:00.000Z');
                }) as unknown as () => Date,
            });
        });
        const user = Object.assign(new ScopedUser(), {
            id: 'user-1',
            tenantId: 'tenant-1',
        });
        db.users.add(user);

        await expect(db.saveChanges()).rejects.toThrow(
            'The audit clock must be synchronous and must not return a Promise.',
        );
        expect(connection.statements).toEqual([]);
        expect(db.entry(user)?.state).toBe(EntityState.Added);
    });
});

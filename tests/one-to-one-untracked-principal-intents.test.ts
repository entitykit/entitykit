import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, DeleteBehavior, EntityState } from '../src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';
import { sqliteProviderServices } from '../src/providers/sqlite';

class UntrackedSlotParent {
    public id = '';
    public profile: UntrackedSlotProfile | null = null;
}

class UntrackedSlotProfile {
    public id = '';
    public parentId = '';
    public parent: UntrackedSlotParent | null = null;
}

class UntrackedSlotContext extends DbContext {
    public profiles = this.set(UntrackedSlotProfile);

    constructor(private readonly connection: RecordingDatabaseConnection) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection);
    }

    protected override model(model: ModelBuilder): void {
        configureSlotModel(model);
    }
}

class UntrackedSlotSqliteContext extends DbContext {
    public profiles = this.set(UntrackedSlotProfile);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        configureSlotModel(model);
    }
}

function configureSlotModel(model: ModelBuilder): void {
    model.entity(UntrackedSlotParent, entity => {
        entity.toTable('untracked_slot_parents');
        entity.hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('text').isRequired();
    });
    model.entity(UntrackedSlotProfile, entity => {
        entity.toTable('untracked_slot_profiles');
        entity.hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('text').isRequired();
        entity.property(row => row.parentId).hasColumnName('parent_id')
            .hasColumnType('text').isRequired();
        entity.hasOne(UntrackedSlotParent, row => row.parent)
            .withOne(row => row.profile)
            .hasForeignKey(row => row.parentId)
            .onDelete(DeleteBehavior.Cascade);
    });
}

function attachProfiles(order: 'first-first' | 'second-first'): {
    readonly connection: RecordingDatabaseConnection;
    readonly db: UntrackedSlotContext;
    readonly first: UntrackedSlotProfile;
    readonly second: UntrackedSlotProfile;
} {
    const connection = new RecordingDatabaseConnection();
    const db = UntrackedSlotContext.create(connection);
    const first = Object.assign(new UntrackedSlotProfile(), {
        id: 'd1', parentId: 'p1',
    });
    const second = Object.assign(new UntrackedSlotProfile(), {
        id: 'd2', parentId: 'p2',
    });
    for (const profile of order === 'first-first'
        ? [first, second]
        : [second, first]) db.profiles.attach(profile);
    return { connection, db, first, second };
}

describe('one-to-one intents with untracked principals', () => {
    it.each(['first-first', 'second-first'] as const)(
        'rejects an FK-only swap before mutation when tracked %s',
        async order => {
            const value = attachProfiles(order);
            value.first.parentId = 'p2';
            value.second.parentId = 'p1';

            expect(() => {
                value.db.changeTracker.detectChanges();
            }).toThrow(
                'cannot atomically swap one-to-one relationships',
            );

            expect(value.connection.statements).toEqual([]);
            expect(value.db.entry(value.first)?.state).toBe(EntityState.Unchanged);
            expect(value.db.entry(value.second)?.state).toBe(EntityState.Unchanged);
            expect(value.first.parentId).toBe('p2');
            expect(value.second.parentId).toBe('p1');
            await value.db.dispose();
        },
    );

    it.each(['first-first', 'second-first'] as const)(
        'rejects FK-only displacement of an occupied untracked slot when tracked %s',
        async order => {
            const value = attachProfiles(order);
            value.first.parentId = 'p2';

            expect(() => {
                value.db.changeTracker.detectChanges();
            }).toThrow(
                'targets an occupied principal that is not tracked',
            );

            expect(value.connection.statements).toEqual([]);
            expect(value.db.entry(value.first)?.state).toBe(EntityState.Unchanged);
            expect(value.db.entry(value.second)?.state).toBe(EntityState.Unchanged);
            expect(value.first.parentId).toBe('p2');
            expect(value.second.parentId).toBe('p2');
            await value.db.dispose();
        },
    );

    it.each(['first-first', 'second-first'] as const)(
        'persists an FK-only chain terminal-first when tracked %s',
        async order => {
            const db = UntrackedSlotSqliteContext.create();
            await db.database.connection.query({
                text: db.database.createScript(), values: [],
            });
            await db.database.connection.query({
                text: 'insert into untracked_slot_parents (id) ' +
                    'values (?), (?), (?)',
                values: ['p1', 'p2', 'p3'],
            });
            await db.database.connection.query({
                text: 'insert into untracked_slot_profiles (id, parent_id) ' +
                    'values (?, ?), (?, ?)',
                values: ['d1', 'p1', 'd2', 'p2'],
            });
            const first = Object.assign(new UntrackedSlotProfile(), {
                id: 'd1', parentId: 'p1',
            });
            const second = Object.assign(new UntrackedSlotProfile(), {
                id: 'd2', parentId: 'p2',
            });
            for (const profile of order === 'first-first'
                ? [first, second]
                : [second, first]) db.profiles.attach(profile);
            first.parentId = 'p2';
            second.parentId = 'p3';

            await expect(db.saveChanges()).resolves.toBe(2);

            const stored = await db.database.connection.query<{
                id: string; parent_id: string;
            }>({
                text: 'select id, parent_id from untracked_slot_profiles ' +
                    'order by id',
                values: [],
            });
            expect(stored.rows).toEqual([
                { id: 'd1', parent_id: 'p2' },
                { id: 'd2', parent_id: 'p3' },
            ]);
            await db.dispose();
        },
    );
});

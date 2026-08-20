import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, DeleteBehavior, EntityState } from '../packages/core/src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class AddedOwner {
    public id = '';
    public profile: AddedProfile | null = null;
}

class AddedProfile {
    public id = '';
    public ownerId: string | null = null;
    public owner: AddedOwner | null = null;
}

class AddedOwnerContext extends DbContext {
    public owners = this.set(AddedOwner);
    public profiles = this.set(AddedProfile);

    constructor(
        private readonly connection: RecordingDatabaseConnection,
        private readonly behavior: DeleteBehavior,
        private readonly optional: boolean,
    ) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(AddedOwner, entity => {
            entity.toTable('added_owners');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        model.entity(AddedProfile, entity => {
            entity.toTable('added_profiles');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            const foreignKey = entity.property(row => row.ownerId)
                .hasColumnName('owner_id').hasColumnType('text');
            if (this.optional) foreignKey.isOptional();
            else foreignKey.isRequired();
            entity.hasOne(AddedOwner, row => row.owner)
                .withOne(row => row.profile)
                .hasForeignKey(row => row.ownerId)
                .onDelete(this.behavior);
        });
    }
}

type ClaimStyle = 'navigation' | 'foreign-key' | 'mixed';

function graph(
    behavior: DeleteBehavior,
    principalState: 'added' | 'existing',
    order: 'first-first' | 'second-first',
    style: ClaimStyle,
): {
    readonly connection: RecordingDatabaseConnection;
    readonly db: AddedOwnerContext;
    readonly owner: AddedOwner;
    readonly first: AddedProfile;
    readonly second: AddedProfile;
} {
    const connection = new RecordingDatabaseConnection();
    const optional = behavior === DeleteBehavior.SetNull;
    const db = AddedOwnerContext.create(connection, behavior, optional);
    const owner = Object.assign(new AddedOwner(), { id: 'owner-1' });
    const first = Object.assign(new AddedProfile(), {
        id: 'profile-1',
        ownerId: style === 'foreign-key' ? 'owner-1' : null,
        owner: style === 'foreign-key' ? null : owner,
    });
    const second = Object.assign(new AddedProfile(), {
        id: 'profile-2',
        ownerId: style === 'navigation' ? null : 'owner-1',
        owner: style === 'navigation' ? owner : null,
    });
    if (principalState === 'added') db.owners.add(owner);
    else db.owners.attach(owner);
    for (const profile of order === 'first-first'
        ? [first, second]
        : [second, first]) db.profiles.add(profile);
    return { connection, db, owner, first, second };
}

describe('Added one-to-one ownership conflicts', () => {
    it.each([
        ...[DeleteBehavior.Cascade, DeleteBehavior.NoAction,
            DeleteBehavior.Restrict, DeleteBehavior.SetNull]
            .flatMap(behavior => [
                [behavior, 'first-first'], [behavior, 'second-first'],
            ] as const),
    ])('rejects two Added dependents for %s tracked %s', async (behavior, order) => {
        const value = graph(
            behavior,
            'existing',
            order,
            behavior === DeleteBehavior.SetNull ? 'foreign-key' : 'navigation',
        );
        const entries = [value.first, value.second, value.owner].map(
            entity => value.db.entry(entity),
        );
        const originals = entries.map(entry => entry?.originalValues);
        const loaded = entries.map(entry => entry?.loadedNavigations());

        await expect(value.db.saveChanges()).rejects.toThrow(
            'has more than one explicit dependent for the same principal',
        );

        expect(value.connection.statements).toEqual([]);
        expect(value.db.entry(value.first)?.state).toBe(EntityState.Added);
        expect(value.db.entry(value.second)?.state).toBe(EntityState.Added);
        expect(value.first.ownerId).toBe(
            behavior === DeleteBehavior.SetNull ? 'owner-1' : null,
        );
        expect(value.second.ownerId).toBe(
            behavior === DeleteBehavior.SetNull ? 'owner-1' : null,
        );
        expect(value.owner.profile).toBeNull();
        expect(entries.map(entry => entry?.originalValues)).toEqual(originals);
        expect(entries.map(entry => entry?.loadedNavigations())).toEqual(loaded);
        await value.db.dispose();
    });

    it.each([
        ['added', 'first-first', 'navigation'],
        ['added', 'second-first', 'foreign-key'],
        ['existing', 'first-first', 'mixed'],
        ['existing', 'second-first', 'mixed'],
    ] as const)(
        'rejects %s principal, %s tracking, %s claims deterministically',
        async (principalState, order, style) => {
            const value = graph(
                DeleteBehavior.Cascade, principalState, order, style,
            );

            await expect(value.db.saveChanges()).rejects.toThrow(
                'One-to-one relationship \'owner\' has more than one explicit ' +
                'dependent for the same principal.',
            );

            expect(value.connection.statements).toEqual([]);
            expect(value.db.entry(value.first)?.state).toBe(EntityState.Added);
            expect(value.db.entry(value.second)?.state).toBe(EntityState.Added);
            expect(value.owner.profile).toBeNull();
            await value.db.dispose();
        },
    );

    it.each(['first-first', 'second-first'] as const)(
        'rejects three final claims tracked %s without detaching any', async order => {
            const value = graph(
                DeleteBehavior.Cascade, 'existing', order, 'foreign-key',
            );
            const third = Object.assign(new AddedProfile(), {
                id: 'profile-3', ownerId: 'owner-1',
            });
            value.db.profiles.add(third);

            await expect(value.db.saveChanges()).rejects.toThrow(
                'has more than one explicit dependent for the same principal',
            );

            expect(value.connection.statements).toEqual([]);
            expect([
                value.db.entry(value.first)?.state,
                value.db.entry(value.second)?.state,
                value.db.entry(third)?.state,
            ]).toEqual([
                EntityState.Added, EntityState.Added, EntityState.Added,
            ]);
            await value.db.dispose();
        });
});

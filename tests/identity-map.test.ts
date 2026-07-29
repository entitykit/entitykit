import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, EntityState } from '../src';
import {
    internalChangeTracker,
    setMetadata,
} from './support/public-api-internals';

class User {
    public id!: string;
    public email!: string;
    public name!: string;

    constructor(data?: Partial<User>) {
        Object.assign(this, data);
    }
}

class AppDbContext extends DbContext {
    public users = this.set(User);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.usePostgres('postgres://localhost/entitykit_test');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(User, entity => {
            entity.toTable('users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
            entity.property(user => user.name).hasColumnName('name').hasColumnType('text').isRequired();
        });
    }
}

describe('ChangeTracker identity map', () => {
    it('prevents tracking two different instances with the same key', () => {
        const db =  AppDbContext.create();
        const first = new User({ id: 'usr_1', email: 'a@example.com', name: 'A' });
        const second = new User({ id: 'usr_1', email: 'b@example.com', name: 'B' });

        db.users.add(first);

        expect(() => db.users.add(second)).toThrow('already tracked');
        expect(db.changeTracker.entries()).toHaveLength(1);
    });

    it('allows tracking the same unchanged instance by identity without refreshing values', () => {
        const db =  AppDbContext.create();
        const first = new User({ id: 'usr_1', email: 'a@example.com', name: 'A' });
        const second = new User({ id: 'usr_1', email: 'b@example.com', name: 'B' });

        const firstEntry = db.users.attach(first);
        const secondEntry = db.users.attach(second);

        expect(secondEntry).toBe(firstEntry);
        expect(secondEntry.entity).toBe(first);
        expect(first).toMatchObject({ email: 'a@example.com', name: 'A' });
        expect(db.entry(second)).toBeUndefined();
        expect(db.changeTracker.entries()).toHaveLength(1);
    });

    it('can look up entries by metadata and primary key', () => {
        const db =  AppDbContext.create();
        const user = new User({ id: 'usr_1', email: 'a@example.com', name: 'A' });

        const entry = db.users.attach(user);
        const found = internalChangeTracker(db.changeTracker)
            .tryGetByIdentity(setMetadata(db.users), 'usr_1');

        expect(found).toBe(entry);
        expect(db.entry(user)).toBe(entry);
    });

    it('removes the registered identity when a key-mutated entity is detached', () => {
        const db =  AppDbContext.create();
        const original = new User({
            id: 'old',
            email: 'old@example.com',
            name: 'Old',
        });
        db.users.attach(original);
        original.id = 'new';

        db.users.detach(original);

        expect(internalChangeTracker(db.changeTracker)
            .tryGetByIdentity(setMetadata(db.users), 'old'))
            .toBeUndefined();
        expect(internalChangeTracker(db.changeTracker)
            .tryGetByIdentity(setMetadata(db.users), 'new'))
            .toBeUndefined();

        const replacement = new User({
            id: 'old',
            email: 'replacement@example.com',
            name: 'Replacement',
        });
        expect(db.users.attach(replacement).entity).toBe(replacement);
    });

    it('does not accept a primary-key mutation into the identity map', () => {
        const db =  AppDbContext.create();
        const user = new User({
            id: 'old',
            email: 'a@example.com',
            name: 'A',
        });
        const entry = db.users.attach(user);
        user.id = 'new';

        expect(() => {
            db.changeTracker.acceptAllChanges();
        })
            .toThrow('Primary key changes are not supported');
        expect(entry.originalValues.id).toBe('old');
        expect(internalChangeTracker(db.changeTracker)
            .tryGetByIdentity(setMetadata(db.users), 'old'))
            .toBe(entry);
        expect(internalChangeTracker(db.changeTracker)
            .tryGetByIdentity(setMetadata(db.users), 'new'))
            .toBeUndefined();
    });

    it('atomically registers the final key of an added entity', () => {
        const db =  AppDbContext.create();
        const user = new User({
            id: 'temporary',
            email: 'a@example.com',
            name: 'A',
        });
        const entry = db.users.add(user);
        user.id = 'final';

        db.changeTracker.acceptAllChanges();

        expect(internalChangeTracker(db.changeTracker)
            .tryGetByIdentity(setMetadata(db.users), 'temporary'))
            .toBeUndefined();
        expect(internalChangeTracker(db.changeTracker)
            .tryGetByIdentity(setMetadata(db.users), 'final'))
            .toBe(entry);
    });

    it('accepts all changes and detaches deleted entities', () => {
        const db =  AppDbContext.create();
        const user = new User({ id: 'usr_1', email: 'a@example.com', name: 'A' });

        const entry = db.users.attach(user);
        user.name = 'B';
        db.changeTracker.detectChanges();
        expect(entry.state).toBe(EntityState.Modified);

        db.changeTracker.acceptAllChanges();
        expect(entry.state).toBe(EntityState.Unchanged);
        expect(entry.originalValues.name).toBe('B');

        db.users.remove(user);
        db.changeTracker.acceptAllChanges();
        expect(db.changeTracker.entries()).toHaveLength(0);
        expect(entry.state).toBe(EntityState.Detached);
    });

    it('clears all identity-map and entity tracking state', () => {
        const db =  AppDbContext.create();
        const user = new User({ id: 'usr_1', email: 'a@example.com', name: 'A' });

        db.users.attach(user);
        db.changeTracker.clear();

        expect(db.entry(user)).toBeUndefined();
        expect(db.changeTracker.entries()).toHaveLength(0);
        expect(db.changeTracker.debugView()).toBe('No tracked entities.');
    });
});

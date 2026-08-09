import { ModelBuilder as ModelBuilderImplementation } from '../src/model/model-builder';
import {
    EntityState,
} from '../src';
import type { EntityMetadata } from '../src/model/entity-metadata';
import { Materializer } from '../src/experimental';
import { ChangeTracker } from '../src/tracking/change-tracker';

class User {
    public id!: string;
    public email!: string;
    public name!: string;
    public createdAt!: Date;

    constructor(data?: Partial<User>) {
        Object.assign(this, data);
    }
}

class AccessorUser {
    public id!: string;
    private storedName = '';
    public setterCalls = 0;

    public get name(): string {
        return this.storedName;
    }

    public set name(value: string) {
        this.setterCalls++;
        this.storedName = value.toUpperCase();
    }
}

class RequiredConstructorUser {
    constructor(
        public readonly id: string,
        public email: string,
    ) {}
}

class RequiredConstructorAddress {
    public city!: string;
}

class UserWithRequiredComplexConstructor {
    constructor(
        public readonly id: string,
        public readonly address: RequiredConstructorAddress,
    ) {}
}

function createUserMetadata(): EntityMetadata<User> {
    const model = new ModelBuilderImplementation();
    model.entity(User, entity => {
        entity.toTable('users');
        entity.hasKey(user => user.id);
        entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
        entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
        entity.property(user => user.name).hasColumnName('display_name').hasColumnType('text').isRequired();
        entity.property(user => user.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired();
    });
    return model.build().getEntity(User);
}

function createAccessorUserMetadata(): EntityMetadata<AccessorUser> {
    return new ModelBuilderImplementation()
        .entity(AccessorUser, entity => {
            entity.toTable('accessor_users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnType('text').isRequired();
            entity.property(user => user.name).hasColumnType('text').isRequired();
        })
        .build()
        .getEntity(AccessorUser);
}

describe('Materializer', () => {
    it('uses an explicit factory to rehydrate required constructors', () => {
        const metadata = new ModelBuilderImplementation()
            .entity(RequiredConstructorUser, entity => {
                entity.toTable('required_constructor_users');
                entity.hasKey(user => user.id);
                entity.property(user => user.id)
                    .hasColumnType('text').isRequired();
                entity.property(user => user.email)
                    .hasColumnType('text').isRequired();
                entity.materialize(values => new RequiredConstructorUser(
                    values.id ?? '',
                    values.email ?? '',
                ));
            })
            .build()
            .getEntity(RequiredConstructorUser);

        const user = new Materializer().materialize(metadata, {
            id: 'usr_required',
            email: 'required@example.com',
        }, new ChangeTracker());

        expect(user).toBeInstanceOf(RequiredConstructorUser);
        expect(user.id).toBe('usr_required');
        expect(user.email).toBe('required@example.com');
    });

    it('supplies nested model values to an explicit materialization factory', () => {
        const metadata = new ModelBuilderImplementation()
            .entity(UserWithRequiredComplexConstructor, entity => {
                entity.toTable('users_with_addresses');
                entity.hasKey(user => user.id);
                entity.property(user => user.id)
                    .hasColumnType('text').isRequired();
                entity.complexProperty(
                    user => user.address,
                    { constructor: RequiredConstructorAddress, required: true },
                    address => {
                        address.property(value => value.city)
                            .hasColumnName('address_city')
                            .hasColumnType('text')
                            .isRequired();
                    },
                );
                entity.materialize(values =>
                    new UserWithRequiredComplexConstructor(
                        values.id ?? '',
                        values.address ?? new RequiredConstructorAddress(),
                    ));
            })
            .build()
            .getEntity(UserWithRequiredComplexConstructor);

        const user = new Materializer().materialize(metadata, {
            id: 'usr_required_complex',
            address_city: 'Paris',
        }, new ChangeTracker());

        expect(user.address).toBeInstanceOf(RequiredConstructorAddress);
        expect(user.address.city).toBe('Paris');
    });

    it('uses entity property setters while materializing mapped values', () => {
        const metadata = createAccessorUserMetadata();
        const user = new Materializer().materialize(metadata, {
            id: 'usr_1',
            name: 'ada',
        }, new ChangeTracker());

        expect(user.name).toBe('ADA');
        expect(user.setterCalls).toBe(1);
        expect(Object.prototype.hasOwnProperty.call(user, 'name')).toBe(false);
    });

    it('materializes rows into configured class instances and tracks them', () => {
        const metadata = createUserMetadata();
        const tracker = new ChangeTracker();
        const createdAt = new Date('2026-01-01T00:00:00.000Z');

        const user = new Materializer().materialize(metadata, {
            id: 'usr_1',
            email: 'a@example.com',
            display_name: 'A',
            created_at: createdAt,
        }, tracker);

        expect(user).toBeInstanceOf(User);
        expect(user).toMatchObject({
            id: 'usr_1',
            email: 'a@example.com',
            name: 'A',
            createdAt,
        });

        const entry = tracker.entry(user);
        expect(entry?.state).toBe(EntityState.Unchanged);
        expect(entry?.originalValues).toMatchObject({
            id: 'usr_1',
            email: 'a@example.com',
            name: 'A',
            createdAt,
        });
    });

    it('materializes partial rows without identity resolution or tracking', () => {
        const metadata = createUserMetadata();
        const materializer = new Materializer();
        const users = materializer.materializeManyUntracked(metadata, [
            { display_name: 'First' },
            { display_name: 'Second' },
        ]);

        expect(users).toHaveLength(2);
        expect(users[0]).not.toBe(users[1]);
        expect(users[0]).toMatchObject({ name: 'First' });
        expect(users[0].id).toBeUndefined();
        expect(users[1]).toMatchObject({ name: 'Second' });
    });

    it('reuses identity-map instances without overwriting local changes', () => {
        const metadata = createUserMetadata();
        const tracker = new ChangeTracker();
        const materializer = new Materializer();

        const first = materializer.materialize(metadata, {
            id: 'usr_1',
            email: 'a@example.com',
            display_name: 'A',
            created_at: new Date('2026-01-01T00:00:00.000Z'),
        }, tracker);

        first.name = 'Locally changed';

        const second = materializer.materialize(metadata, {
            id: 'usr_1',
            email: 'other@example.com',
            display_name: 'Database value',
            created_at: new Date('2026-01-02T00:00:00.000Z'),
        }, tracker);

        expect(second).toBe(first);
        expect(second.name).toBe('Locally changed');
        expect(tracker.entries()).toHaveLength(1);
    });

    it('keeps the first materialized values when duplicate keys conflict in one result set', () => {
        const metadata = createUserMetadata();
        const tracker = new ChangeTracker();
        const users = new Materializer().materializeMany(metadata, [
            {
                id: 'usr_1',
                email: 'first@example.com',
                display_name: 'First',
                created_at: new Date('2026-01-01T00:00:00.000Z'),
            },
            {
                id: 'usr_1',
                email: 'second@example.com',
                display_name: 'Second',
                created_at: new Date('2026-01-02T00:00:00.000Z'),
            },
        ], tracker);

        expect(users).toHaveLength(2);
        expect(users[1]).toBe(users[0]);
        expect(users[0]).toMatchObject({
            email: 'first@example.com',
            name: 'First',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
        });
        expect(tracker.entries()).toHaveLength(1);
    });

    it('does not refresh an existing tracked instance from a later provider row', () => {
        const metadata = createUserMetadata();
        const tracker = new ChangeTracker();
        const tracked = new User({
            id: 'usr_1',
            email: 'tracked@example.com',
            name: 'Tracked',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
        });
        tracker.track(tracked, metadata, EntityState.Unchanged, {
            id: tracked.id,
            email: tracked.email,
            name: tracked.name,
            createdAt: tracked.createdAt,
        });

        const materialized = new Materializer().materialize(metadata, {
            id: 'usr_1',
            email: 'database@example.com',
            display_name: 'Database',
            created_at: new Date('2026-01-02T00:00:00.000Z'),
        }, tracker);

        expect(materialized).toBe(tracked);
        expect(materialized).toMatchObject({
            email: 'tracked@example.com',
            name: 'Tracked',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
        });
        expect(tracker.entry(tracked)?.originalValues).toMatchObject({
            email: 'tracked@example.com',
            name: 'Tracked',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
        });
    });

    it('materializes multiple rows', () => {
        const metadata = createUserMetadata();
        const tracker = new ChangeTracker();

        const users = new Materializer().materializeMany(metadata, [
            { id: 'usr_1', email: 'a@example.com', display_name: 'A', created_at: new Date() },
            { id: 'usr_2', email: 'b@example.com', display_name: 'B', created_at: new Date() },
        ], tracker);

        expect(users).toHaveLength(2);
        expect(users.every(user => user instanceof User)).toBe(true);
        expect(tracker.entries()).toHaveLength(2);
    });
});

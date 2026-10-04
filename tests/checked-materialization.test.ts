import { ModelBuilder } from '../packages/core/src/model/model-builder';
import type { EntityBuilder } from '../packages/core/src/model/entity-builder-types';
import type { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import { Materializer } from '../packages/core/src/materialization/materializer';
import { ChangeTracker } from '../packages/core/src/tracking/change-tracker';
import type { MaterializationGuard } from '../packages/core/src';

class User {
    public nickname: string | null = null;
    public role: 'reader' | 'writer' = 'reader';
    public friends: User[] = [];
    constructor(public id: string, public name: string) {}
    public greeting(): string {
        return `Hello ${this.name}`;
    }
}

function metadata(configure?: (entity: EntityBuilder<User>) => void): EntityMetadata<User> {
    return new ModelBuilder().entity(User, entity => {
        entity.toTable('users').hasKey(user => user.id);
        entity.property(user => user.id).hasColumnType('text').isRequired();
        entity.property(user => user.name).hasColumnName('display_name').hasColumnType('text').isRequired();
        entity.property(user => user.nickname).hasColumnType('text');
        entity.materializeChecked(row => new User(row.required(user => user.id), row.required(user => user.name)));
        configure?.(entity);
    }).build().getEntity(User);
}

describe('checked materialization', () => {
    it.each(['tracked', 'untracked'])('assigns captured values after %s constructor normalization', mode => {
        class NormalizingUser extends User {
            public readonly constructedName: string;
            constructor(id: string, name: string) {
                super(id, name.trim());
                this.constructedName = this.name;
            }
        }
        const mapping = metadata(entity => entity.materializeChecked(row => new NormalizingUser(
            row.required(user => user.id), row.required(user => user.name),
        )));
        const tracker = new ChangeTracker();
        const reader = new Materializer();
        const row = { id: '1', display_name: ' Ada ', nickname: null };
        const user = mode === 'tracked'
            ? reader.materialize(mapping, row, tracker)
            : reader.materializeUntracked(mapping, row);

        expect(user).toBeInstanceOf(NormalizingUser);
        expect(user).toMatchObject({ constructedName: 'Ada', name: ' Ada ' });
        if (mode === 'tracked') {
            expect(tracker.entry(user)?.originalValues.name).toBe(' Ada ');
            expect(tracker.entry(user)?.modifiedProperties()).toEqual([]);
        }
    });

    it('does not add scalar validation for values the factory does not request', () => {
        const user = new Materializer().materializeUntracked(metadata(), {
            id: '1', display_name: 'Ada', nickname: 42,
        });
        expect(user.nickname).toBe(42);
    });

    it('constructs the domain object and retains tracked identity and local edits', () => {
        const mapping = metadata();
        const tracker = new ChangeTracker();
        const reader = new Materializer();
        const user = reader.materialize(mapping, { id: '1', display_name: 'Ada', nickname: null }, tracker);
        expect(user).toBeInstanceOf(User);
        expect(user.greeting()).toBe('Hello Ada');
        user.name = 'Local';
        expect(reader.materialize(mapping, { id: '1', display_name: 'Remote' }, tracker)).toBe(user);
        expect(user.name).toBe('Local');
        expect(tracker.entries()).toHaveLength(1);
    });

    it.each([undefined, null, 42, {}, false])('rejects invalid required values without tracking a partial entity: %p', value => {
        const tracker = new ChangeTracker();
        expect(() => new Materializer().materialize(metadata(), { id: '1', display_name: value }, tracker))
            .toThrow('Cannot materialize \'User.name\'');
        expect(tracker.entries()).toHaveLength(0);
    });

    it('distinguishes an absent value from SQL NULL', () => {
        const mapping = metadata(entity => entity.materializeChecked(row => {
            const user = new User(row.required(item => item.id), row.required(item => item.name));
            user.nickname = row.nullable(item => item.nickname);
            return user;
        }));
        const reader = new Materializer();
        expect(reader.materializeUntracked(mapping, { id: '1', display_name: 'Ada', nickname: null }).nickname).toBeNull();
        expect(() => reader.materializeUntracked(mapping, { id: '1', display_name: 'Ada' })).toThrow('the mapped value is missing');
    });

    it('does not let nullable access weaken required mapping', () => {
        const mapping = metadata(entity => entity.materializeChecked(row => {
            row.nullable(item => item.name);
            return new User('1', 'Ada');
        }));
        expect(() => new Materializer().materializeUntracked(mapping, { display_name: null })).toThrow('NULL is not allowed');
    });

    it('rejects navigation and method selectors', () => {
        for (const select of ['friends', 'greeting'] as const) {
            const mapping = metadata(entity => entity.materializeChecked(row => {
                row.required<unknown>(user => user[select]);
                return new User('1', 'Ada');
            }));
            expect(() => new Materializer().materializeUntracked(mapping, {})).toThrow('select a mapped scalar property');
        }
    });

    it('checks converted values explicitly without repeating read conversion', () => {
        let conversions = 0;
        const isRole = (value: unknown): value is User['role'] => value === 'reader' || value === 'writer';
        const mapping = metadata(entity => {
            entity.property(user => user.role).hasColumnType('text').hasConversion({
                toProvider: (value: unknown) => value,
                fromProvider: (value: unknown) => {
                    conversions++; return value as User['role'];
                },
            });
            entity.materializeChecked(row => {
                const reads = conversions;
                const user = new User(row.required(item => item.id), row.required(item => item.name));
                user.role = row.required(item => item.role, isRole);
                expect(row.required(item => item.role, isRole)).toBe(user.role);
                expect(conversions).toBe(reads);
                return user;
            });
        });
        const reader = new Materializer();
        expect(reader.materializeUntracked(mapping, { id: '1', display_name: 'Ada', role: 'writer' }).role).toBe('writer');
        expect(() => reader.materializeUntracked(mapping, { id: '2', display_name: 'Ada', role: 'admin' }))
            .toThrow('Cannot materialize \'User.role\': the value did not pass its guard');
    });

    it('requires a guard for conversions and ambiguous SQL representations', () => {
        const converted = metadata(entity => entity.property(user => user.name).hasConversion({
            toProvider: (value: unknown) => value, fromProvider: (value: unknown) => value as string,
        }));
        const ambiguous = metadata(entity => entity.property(user => user.name).hasColumnType('numeric'));
        for (const mapping of [converted, ambiguous]) {
            expect(() => new Materializer().materializeUntracked(mapping, { id: '1', display_name: 'Ada' }))
                .toThrow('requires an explicit value guard');
        }
    });

    it('reports throwing and asynchronous guards with their property', () => {
        const cause = new Error('domain failure');
        const guards: Array<MaterializationGuard<string>> = [
            (value: unknown): value is string => {
                void value;
                throw cause;
            },
            (async () => Promise.resolve(true)) as unknown as MaterializationGuard<string>,
            (() => 'truthy') as unknown as MaterializationGuard<string>,
        ];
        for (const guard of guards) {
            const mapping = metadata(entity => entity.materializeChecked(row => new User('1', row.required(user => user.name, guard))));
            expect(() => new Materializer().materializeUntracked(mapping, { display_name: 'Ada' })).toThrow('User.name');
        }
    });

    it('retains freshness and synchronous materializer checks', () => {
        const singleton = new User('1', 'Ada');
        const mapping = metadata(entity => entity.materializeChecked(() => singleton));
        const reader = new Materializer();
        reader.materializeUntracked(mapping, { id: '1', display_name: 'Ada' });
        expect(() => reader.materializeUntracked(mapping, { id: '2', display_name: 'Other' })).toThrow('fresh instance');
        const asynchronous = metadata(entity => entity.materializeChecked((async () => Promise.resolve(singleton)) as never));
        expect(() => reader.materializeUntracked(asynchronous, {})).toThrow('must be synchronous');
    });

    it('lets the last factory registration select the rehydration policy', () => {
        const mapping = metadata(entity => entity.materialize(() => new User('fallback', 'Default')));
        expect(new Materializer().materializeUntracked(mapping, { id: '1', display_name: 'Ada' }).name).toBe('Ada');
    });
});

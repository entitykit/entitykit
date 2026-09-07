import { EntityState, type EntityCreationFactory } from '../packages/core/src';
import { RecordingDatabaseConnection } from '../packages/testing/src';
import { internalChangeTracker } from './support/public-api-internals';
import { CreationContext, CreationUser } from './support/creation-context';

describe('DbSet creation failures', () => {
    it('leaves no entry after constructor or factory failure', async () => {
        const connection = new RecordingDatabaseConnection();
        await using db = CreationContext.create({ connection });
        expect(() => db.users.create({ id: 'bad', name: ' ' })).toThrow('A name is required.');
        const failure = new Error('domain factory failed');
        const users = db.set(CreationUser, { create: (): CreationUser => {
            throw failure;
        } });
        expect(() => users.create()).toThrow(failure);
        expect(db.changeTracker.entries()).toEqual([]);
        expect(connection.operations).toEqual([]);
    });

    it('rejects invalid factory options without changing a cached set', async () => {
        await using db = CreationContext.create();
        // @ts-expect-error JavaScript callers can omit the required factory.
        expect(() => db.set(CreationUser, {})).toThrow('must provide a create function');
        expect(db.set(CreationUser)).toBe(db.users);
    });

    it.each([null, undefined, 42, {}, { id: 'plain', name: 'Plain' }])(
        'rejects a non-entity result (%p) before enrollment', async result => {
            await using db = CreationContext.create();
            const factory = (() => result) as unknown as EntityCreationFactory<CreationUser>;
            expect(() => db.set(CreationUser, { create: factory }).create()).toThrow('must return an instance');
            expect(db.changeTracker.entries()).toEqual([]);
        },
    );

    it.each(['resolve', 'reject', 'thenable'])(
        'rejects %s asynchronous results without an unhandled rejection', async mode => {
            await using db = CreationContext.create();
            const factory = ((): unknown => {
                if (mode === 'reject') return Promise.reject(new Error('async failure'));
                if (mode === 'thenable') return { then: (): void => undefined };
                return Promise.resolve(new CreationUser({ id: 'async', name: 'Async' }));
            }) as unknown as EntityCreationFactory<CreationUser>;
            const unhandled: unknown[] = [];
            const observe = (reason: unknown): void => {
                unhandled.push(reason);
            };
            process.on('unhandledRejection', observe);
            try {
                expect(() => db.set(CreationUser, { create: factory }).create()).toThrow('must be synchronous');
                await new Promise<void>(resolve => setImmediate(resolve));
                expect(unhandled).toEqual([]);
                expect(db.changeTracker.entries()).toEqual([]);
            } finally {
                process.off('unhandledRejection', observe);
            }
        },
    );

    it.each([EntityState.Added, EntityState.Unchanged])(
        'rejects a reused %s entity without changing its state', async state => {
            await using db = CreationContext.create();
            const user = new CreationUser({ id: 'existing', name: 'Existing' });
            if (state === EntityState.Added) db.users.add(user);
            else db.users.attach(user);
            const set = db.set(CreationUser, { create: () => user });
            expect(() => set.create()).toThrow('fresh, untracked entity');
            expect(db.entry(user)?.state).toBe(state);
            expect(db.changeTracker.entries()).toHaveLength(1);
        },
    );

    it('rolls back tracker registration when enrollment fails', async () => {
        await using db = CreationContext.create();
        const candidate = new CreationUser({ id: 'observer', name: 'Observer' });
        const tracker = internalChangeTracker(db.changeTracker);
        tracker.observeTracked(() => {
            throw new Error('observer failed');
        });
        expect(() => db.set(CreationUser, { create: () => candidate }).create()).toThrow('observer failed');
        expect(db.entry(candidate)).toBeUndefined();
        expect(db.changeTracker.entries()).toEqual([]);
        tracker.observeTracked(() => undefined);
        expect(db.users.create({ id: 'observer', name: 'Retry' }).name).toBe('Retry');
    });

    it('checks disposal and read-only mappings before invoking user construction', async () => {
        const db = CreationContext.create();
        const factory = jest.fn(() => new CreationUser({ id: 'unused', name: 'Unused' }));
        const bound = db.set(CreationUser, { create: factory });
        await db.dispose();
        expect(() => bound.create()).toThrow('disposed');
        await using readOnly = CreationContext.create({ readOnly: true });
        expect(() => readOnly.set(CreationUser, { create: factory }).create()).toThrow('create() is not supported');
        expect(factory).not.toHaveBeenCalled();
    });
});

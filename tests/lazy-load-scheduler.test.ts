import { LazyLoadScheduler } from '../packages/core/src/core/lazy-load-scheduler';
import type { EntityEntry } from '../packages/core/src/tracking/entity-entry';

const entry = {} as EntityEntry<object>;

async function load(
    scheduler: LazyLoadScheduler,
    navigation: string,
    work: () => Promise<unknown>,
): Promise<unknown> {
    return await (scheduler.get(entry, navigation)
        ?? scheduler.schedule(entry, navigation, work));
}

describe('lazy-load scheduler', () => {
    it('shares one entry-navigation load without merging another navigation', async () => {
        const scheduler = new LazyLoadScheduler();
        const calls: string[] = [];
        let release = (): void => undefined;
        const gate: Promise<void> = new Promise(resolve => {
            release = resolve;
        });
        const children = ['child'];
        const first = load(scheduler, 'children', async () => {
            calls.push('children');
            await gate;
            return children;
        });
        const duplicate = load(
            scheduler,
            'children',
            async () => await Promise.reject(
                new Error('duplicate work must not run'),
            ),
        );
        const owner = load(scheduler, 'owner', async () => {
            calls.push('owner');
            return await Promise.resolve('parent');
        });

        release();

        const [firstValue, duplicateValue, ownerValue] = await Promise.all([
            first,
            duplicate,
            owner,
        ]);
        expect(firstValue).toBe(children);
        expect(duplicateValue).toBe(children);
        expect(ownerValue).toBe('parent');
        expect(calls).toEqual(['children', 'owner']);
        expect(scheduler.get(entry, 'children')).toBeUndefined();
        expect(scheduler.get(entry, 'owner')).toBeUndefined();
    });

    it('cleans up a failed load and allows queued work and retry', async () => {
        const scheduler = new LazyLoadScheduler();
        let attempts = 0;
        const failed = load(scheduler, 'children', async () => {
            attempts += 1;
            return await Promise.reject(new Error('transient failure'));
        });
        const queued = load(
            scheduler,
            'owner',
            async () => await Promise.resolve('parent'),
        );

        await expect(failed).rejects.toThrow('transient failure');
        await expect(queued).resolves.toBe('parent');
        expect(scheduler.get(entry, 'children')).toBeUndefined();
        await expect(load(scheduler, 'children', async () => {
            attempts += 1;
            return await Promise.resolve(['recovered']);
        })).resolves.toEqual(['recovered']);
        expect(attempts).toBe(2);
    });
});

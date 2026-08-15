import { ContextStateRestorationError } from '../src';
import { requireDefined } from './support/require-defined';
import type {
    RefusalDependent,
} from './support/accessor-refusal-support';
import {
    openRefusalGraph,
    refusalMessage,
    rejection,
} from './support/accessor-refusal-support';
import type { LinkTag } from './support/link-refusal-support';
import {
    insertJoinRow,
    openLinkGraph,
    refusal,
} from './support/link-refusal-support';

/** An untracked copy of a loaded entity, as a hostile setter would keep. */
function cloneOf<TEntity extends object>(row: TEntity): TEntity {
    return Object.assign(new (row.constructor as new () => TEntity)(), row);
}

/** Assert the context reports the standard poisoned-state failure. */
function expectPoison(failure: unknown): ContextStateRestorationError {
    expect(failure).toBeInstanceOf(ContextStateRestorationError);
    expect(failure).toMatchObject({
        name: 'ContextStateRestorationError',
        code: 'CONTEXT_STATE_RESTORATION_FAILED',
    });
    return failure as ContextStateRestorationError;
}

describe('accessor refusal that a navigation restoration cannot undo', () => {
    it('poisons the context when a navigation restoration throws', async () => {
        const db = await openRefusalGraph();
        const first = requireDefined(await db.principals.find('p1'));
        const second = requireDefined(await db.principals.find('p2'));
        const primary = new Error('second principal setter exploded');
        const restorationBoom = new Error('first principal setter exploded');
        let firstCalls = 0;
        let firstStored = first.dependents;
        Object.defineProperty(first, 'dependents', {
            configurable: true,
            enumerable: true,
            get: () => firstStored,
            set: (value: RefusalDependent[]) => {
                firstCalls += 1;
                // Accept the forward write, then refuse to be rolled back.
                if (firstCalls > 1) throw restorationBoom;
                firstStored = value;
            },
        });
        let secondCalls = 0;
        let secondStored = second.dependents;
        Object.defineProperty(second, 'dependents', {
            configurable: true,
            enumerable: true,
            get: () => secondStored,
            set: (value: RefusalDependent[]) => {
                secondCalls += 1;
                if (secondCalls === 1) throw primary;
                secondStored = value;
            },
        });

        const failure = await rejection(async () => db.principals
            .orderBy(row => row.id).include(row => row.dependents).toArray());

        expect(failure).toBe(primary);
        expect(firstCalls).toBe(2);
        expect(secondCalls).toBe(2);
        expect(first.dependents.map(row => row.id)).toEqual(['d1']);
        expect(second.dependents).toEqual([]);
        const poison = expectPoison(
            await rejection(async () => db.principals.count()),
        );
        expect(poison).not.toBe(failure);
        expect(poison.cause).toBe(restorationBoom);
        expect(await rejection(async () => db.dependents.count())).toBe(poison);
        await db.dispose();
    });

    it('poisons the context when an explicit load restoration is refused', async () => {
        const db = await openRefusalGraph();
        const first = requireDefined(await db.principals.find('p1'));
        const dependent = requireDefined(await db.dependents.find('d1'));
        const entry = requireDefined(db.entry(dependent));
        let remembered: RefusalDependent[] | undefined;
        let stored = first.dependents;
        Object.defineProperty(first, 'dependents', {
            configurable: true,
            enumerable: true,
            get: () => stored,
            set: (value: RefusalDependent[]) => {
                remembered ??= value.length > 0
                    ? value.map(row => cloneOf(row))
                    : undefined;
                stored = remembered ?? value;
            },
        });

        const failure = await rejection(async () =>
            entry.reference(row => row.principal).load());

        expect(refusalMessage(failure)).toBe(
            'Navigation \'RefusalPrincipal.dependents\' refused its assigned value.',
        );
        expect(first.dependents.map(row => row.id)).toEqual(['d1']);
        expect(first.dependents[0]).not.toBe(dependent);
        expect(dependent.principal).toBeNull();
        const poison = expectPoison(
            await rejection(async () => db.principals.count()),
        );
        expect(poison).not.toBe(failure);
        expect(refusalMessage(poison.cause)).toBe(
            'Navigation \'RefusalPrincipal.dependents\' refused its restoration value.',
        );
        await db.dispose();
    });

    it('reports the same poison instance from every later operation', async () => {
        const db = await openLinkGraph();
        await insertJoinRow(db, 'post_1', 'tag_1');
        const tag = requireDefined(await db.tags.find('tag_1'));
        const post = requireDefined(await db.posts.find('post_1'));
        let remembered: LinkTag[] | undefined;
        let stored = post.tags;
        Object.defineProperty(post, 'tags', {
            configurable: true,
            enumerable: true,
            get: () => stored,
            set: (value: LinkTag[]) => {
                remembered ??= value.length > 0
                    ? value.map(row => cloneOf(row))
                    : undefined;
                stored = remembered ?? value;
            },
        });

        const failure = await rejection(async () =>
            db.posts.include(row => row.tags).toArray());

        expect(refusalMessage(failure)).toBe(
            'Navigation \'LinkPost.tags\' refused its assigned value.',
        );
        const poison = expectPoison(
            await rejection(async () => db.posts.count()),
        );
        expect(refusalMessage(poison.cause)).toBe(
            'Navigation \'LinkPost.tags\' refused its restoration value.',
        );
        expect(await rejection(async () => db.posts.find('post_1')))
            .toBe(poison);
        expect(await rejection(async () => db.saveChanges())).toBe(poison);
        expect(refusal(() => {
            db.getSavePlan();
        })).toBe(poison);
        expect(refusal(() => {
            db.getSavePlanDebugView();
        })).toBe(poison);
        expect(refusal(() => {
            db.changeTracker.clear();
        })).toBe(poison);
        expect(refusal(() => {
            db.link(post, row => row.tags, tag);
        })).toBe(poison);
        expect(refusal(() => {
            db.unlink(post, row => row.tags, tag);
        })).toBe(poison);
        await db.dispose();
    });
});

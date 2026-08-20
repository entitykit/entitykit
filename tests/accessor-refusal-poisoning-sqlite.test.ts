import { ContextStateRestorationError, EntityState } from '../packages/core/src';
import { requireDefined } from './support/require-defined';
import type {
    RefusalGraphContext,
    RefusalPrincipal,
} from './support/accessor-refusal-support';
import {
    refusalMessage,
    rejection,
    trackedRefusalGraph,
} from './support/accessor-refusal-support';

const uninspectable =
    'Context state restoration produced an uninspectable failure.';

class HostileErrorsAggregate extends AggregateError {
    constructor() {
        super([], 'hostile restoration aggregate');
        Object.defineProperty(this, 'errors', {
            configurable: true,
            get: (): never => {
                throw new Error('errors getter is hostile');
            },
        });
    }
}

function prototypeTrapProxy(): unknown {
    return new Proxy({}, {
        getPrototypeOf: (): never => {
            throw new Error('getPrototypeOf trap is hostile');
        },
    });
}

const hostileShapes: ReadonlyArray<readonly [string, () => unknown]> = [
    ['an aggregate whose errors getter throws', () => new HostileErrorsAggregate()],
    ['a proxy whose getPrototypeOf trap throws', prototypeTrapProxy],
];

function restorationFailures(unusable: unknown): unknown[] {
    const cause = (unusable as Error).cause;
    if (!(cause instanceof AggregateError)) return [cause];
    return [...(cause.errors as unknown[])];
}

function opaqueWrapperFor(unusable: unknown): Error {
    const wrapper = restorationFailures(unusable).find(failure =>
        failure instanceof Error && failure.message === uninspectable);
    expect(wrapper).toBeInstanceOf(Error);
    return wrapper as Error;
}

async function poisonedBy(db: RefusalGraphContext): Promise<unknown> {
    const unusable = await rejection(async () => db.principals.count());
    expect(unusable).toBeInstanceOf(ContextStateRestorationError);
    expect(unusable).toMatchObject({
        name: 'ContextStateRestorationError',
        code: 'CONTEXT_STATE_RESTORATION_FAILED',
    });
    return unusable;
}

describe('accessor refusal that leaves restoration incomplete', () => {
    it('poisons the context when restoration substitutes a navigation clone', async () => {
        const { db, first, second, dependent } = await trackedRefusalGraph();
        const primary = new Error('foreign key setter exploded');
        const writeLog: string[] = [];
        let failed = false;
        let storedKey = dependent.principalId;
        Object.defineProperty(dependent, 'principalId', {
            configurable: true,
            enumerable: true,
            get: () => storedKey,
            set: (value: string) => {
                writeLog.push(`principalId=${value}`);
                storedKey = value;
                if (failed) return;
                failed = true;
                throw primary;
            },
        });
        let storedPrincipal = dependent.principal;
        Object.defineProperty(dependent, 'principal', {
            configurable: true,
            enumerable: true,
            get: () => storedPrincipal,
            set: (value: RefusalPrincipal | null) => {
                writeLog.push(`principal=${value?.id ?? 'null'}`);
                storedPrincipal = failed && value
                    ? Object.assign(new (value.constructor as new () =>
                    RefusalPrincipal)(), value)
                    : value;
            },
        });
        dependent.principal = second;
        writeLog.length = 0;

        const failure = await rejection(() => {
            db.changeTracker.detectChanges();
        });

        expect(failure).toBe(primary);
        expect(dependent.principalId).toBe('p1');
        expect(dependent.principal).not.toBe(first);
        expect(dependent.principal).not.toBe(second);
        expect(db.changeTracker.entry(
            requireDefined(dependent.principal),
        )).toBeUndefined();
        const entry = requireDefined(db.changeTracker.entry(dependent));
        expect(entry.originalValues).toEqual({ id: 'd1', principalId: 'p1' });
        expect(entry.state).toBe(EntityState.Unchanged);
        expect(writeLog).toEqual([
            'principalId=p2', 'principalId=p1', 'principal=p2',
        ]);
        const unusable = await poisonedBy(db);
        expect(refusalMessage((unusable as Error).cause)).toBe(
            'Navigation \'RefusalDependent.principal\' refused its restoration value.',
        );
        expect(await rejection(() => {
            db.changeTracker.clear();
        })).toBe(unusable);
        expect(await rejection(() => db.getSavePlan())).toBe(unusable);
        await expect(db.saveChanges()).rejects.toBe(unusable);
        await db.dispose();
    });

    it.each(hostileShapes)(
        'poisons the context when restoration throws %s',
        async (_label, createHostile) => {
            const { db, second, dependent } = await trackedRefusalGraph();
            const primary = new Error('foreign key setter exploded');
            const hostile = createHostile();
            let writes = 0;
            let storedKey = dependent.principalId;
            Object.defineProperty(dependent, 'principalId', {
                configurable: true,
                enumerable: true,
                get: () => storedKey,
                set: (value: string) => {
                    writes += 1;
                    storedKey = value;
                    if (writes === 1) throw primary;
                    // Deliberately throw a value that resists inspection.
                    if (writes === 2) throw hostile;
                },
            });
            let navigationWrites = 0;
            let storedPrincipal = dependent.principal;
            Object.defineProperty(dependent, 'principal', {
                configurable: true,
                enumerable: true,
                get: () => storedPrincipal,
                set: (value: RefusalPrincipal | null) => {
                    navigationWrites += 1;
                    storedPrincipal = value;
                },
            });
            dependent.principal = second;
            const navigationWritesBefore = navigationWrites;

            const failure = await rejection(() => {
                db.changeTracker.detectChanges();
            });

            expect(failure).toBe(primary);
            expect(writes).toBe(2);
            expect(navigationWrites - navigationWritesBefore).toBe(1);
            expect(dependent.principalId).toBe('p1');
            const entry = requireDefined(db.changeTracker.entry(dependent));
            expect(entry.originalValues).toEqual({
                id: 'd1', principalId: 'p1',
            });
            expect(entry.state).toBe(EntityState.Unchanged);
            const unusable = await poisonedBy(db);
            expect(opaqueWrapperFor(unusable).cause).toBe(hostile);
            expect(await rejection(() => {
                db.changeTracker.clear();
            })).toBe(unusable);
            await expect(db.saveChanges()).rejects.toBe(unusable);
            await db.dispose();
        },
    );
});

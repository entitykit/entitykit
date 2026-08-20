import { runRestorationActions } from '../packages/core/src/restoration-actions';
import {
    appendRestorationFailure,
    restorationErrorFrom,
} from '../packages/core/src/restoration-failure-inspection';
import { RestorationScope } from '../packages/core/src/restoration-scope';

const uninspectable =
    'Context state restoration produced an uninspectable failure.';

const errorsGetterTrap = new Error('errors getter is hostile');
const prototypeTrap = new Error('getPrototypeOf trap is hostile');
const errorsAccessTrap = new Error('errors access is hostile');
const iteratorTrap = new Error('errors iterator is hostile');
const elementTrap = new Error('errors element is hostile');

class HostileErrorsAggregate extends AggregateError {
    constructor() {
        super([], 'hostile errors getter');
        Object.defineProperty(this, 'errors', {
            configurable: true,
            get: (): never => {
                throw errorsGetterTrap;
            },
        });
    }
}

function prototypeTrapProxy(): unknown {
    return new Proxy({}, {
        getPrototypeOf: (): never => {
            throw prototypeTrap;
        },
    });
}

function errorsAccessProxy(): unknown {
    return new Proxy(new AggregateError([], 'proxied aggregate'), {
        get: (target, property): unknown => {
            if (property === 'errors') throw errorsAccessTrap;
            return Reflect.get(target, property) as unknown;
        },
    });
}

function aggregateWithErrorsValue(errors: unknown): unknown {
    const failure = new AggregateError([], 'hostile errors value');
    Object.defineProperty(failure, 'errors', {
        configurable: true,
        value: errors,
    });
    return failure;
}

function hostileIteratorAggregate(): unknown {
    return aggregateWithErrorsValue({
        [Symbol.iterator]: (): never => {
            throw iteratorTrap;
        },
    });
}

function hostileElementAggregate(): unknown {
    const arrayLike = { length: 1 };
    Object.defineProperty(arrayLike, '0', {
        get: (): never => {
            throw elementTrap;
        },
    });
    return aggregateWithErrorsValue(arrayLike);
}

const hostileShapes: ReadonlyArray<readonly [string, () => unknown]> = [
    ['aggregate whose errors getter throws', () => new HostileErrorsAggregate()],
    ['proxy whose getPrototypeOf trap throws', prototypeTrapProxy],
    ['proxy that throws on errors access', errorsAccessProxy],
    ['aggregate whose errors iterator throws', hostileIteratorAggregate],
    ['aggregate whose errors element throws', hostileElementAggregate],
];

function aggregatedErrors(failure: unknown): unknown[] {
    if (!(failure instanceof AggregateError)) {
        throw new Error('Expected an aggregated restoration failure.');
    }
    return failure.errors as unknown[];
}

function opaqueWrapper(value: unknown): Error {
    expect(value).toBeInstanceOf(Error);
    const wrapper = value as Error;
    expect(wrapper.message).toBe(uninspectable);
    return wrapper;
}

describe('hostile restoration failure inspection', () => {
    it.each(hostileShapes)(
        'fails closed when cleanup throws an %s',
        (_label, createHostile) => {
            const hostile = createHostile();
            const primary = 'primary operation failure';
            const cleanup = new Error('later cleanup failed');
            const marked: Error[] = [];
            const attempted: number[] = [];
            const scope = new RestorationScope(failure => {
                marked.push(failure);
            });
            scope.capturePrimary(primary);
            scope.attemptAll([
                () => {
                    attempted.push(1);
                    throw hostile;
                },
                () => {
                    attempted.push(2);
                },
                () => {
                    attempted.push(3);
                    throw cleanup;
                },
            ]);

            expect(attempted).toEqual([1, 2, 3]);
            let rejected = false;
            let thrown: unknown;
            try {
                scope.rethrowPrimary();
            } catch (error) {
                rejected = true;
                thrown = error;
            }
            expect(rejected).toBe(true);
            expect(thrown).toBe(primary);
            expect(marked).toHaveLength(1);
            const errors = aggregatedErrors(marked[0]);
            expect(errors).toHaveLength(2);
            expect(opaqueWrapper(errors[0]).cause).toBe(hostile);
            expect(errors[1]).toBe(cleanup);
            expect(() => {
                scope.throwIfFailed();
            }).toThrow('Multiple context state restoration phases failed.');
        },
    );

    it.each(hostileShapes)(
        'records a lone %s as one opaque cleanup failure',
        (_label, createHostile) => {
            const hostile = createHostile();
            const marked: Error[] = [];
            const scope = new RestorationScope(failure => {
                marked.push(failure);
            });
            scope.recordFailure(hostile);

            expect(marked).toEqual([]);
            let thrown: unknown;
            try {
                scope.throwIfFailed();
            } catch (error) {
                thrown = error;
            }
            expect(marked).toHaveLength(1);
            expect(thrown).toBe(marked[0]);
            expect(opaqueWrapper(thrown).cause).toBe(hostile);
        },
    );

    it('wraps one hostile member and still flattens its siblings', () => {
        const first = new Error('first');
        const second = new Error('second');
        const hostile = prototypeTrapProxy();
        const failures: unknown[] = [];

        appendRestorationFailure(failures, new AggregateError([
            new AggregateError([first]), hostile, second,
        ]));

        expect(failures).toHaveLength(3);
        expect(failures[0]).toBe(first);
        expect(opaqueWrapper(failures[1]).cause).toBe(hostile);
        expect(failures[2]).toBe(second);
    });

    it('keeps inspectable flattening behaviour unchanged', () => {
        const empty = new AggregateError([], 'empty cleanup failed');
        const cyclic = new AggregateError([], 'cyclic cleanup failed');
        (cyclic.errors as unknown[]).push(cyclic);
        const plain = new Error('plain cleanup failed');
        const failures: unknown[] = [];

        appendRestorationFailure(failures, empty);
        appendRestorationFailure(failures, cyclic);
        appendRestorationFailure(failures, plain);
        appendRestorationFailure(failures, 'primitive cleanup failed');

        expect(failures).toHaveLength(4);
        expect(failures[0]).toBe(empty);
        expect(failures[1]).toBe(cyclic);
        expect(failures[2]).toBe(plain);
        expect(failures[3]).toBe('primitive cleanup failed');
        expect(restorationErrorFrom(plain)).toBe(plain);
        const wrapped = restorationErrorFrom(null);
        expect(wrapped.message).toBe('Context state restoration failed.');
        expect(wrapped.cause).toBeNull();
    });

    it('wraps a failure whose Error classification throws', () => {
        const hostile = prototypeTrapProxy();

        expect(opaqueWrapper(restorationErrorFrom(hostile)).cause).toBe(hostile);
    });

    it('runs every restoration action after a hostile failure', () => {
        const hostile = new HostileErrorsAggregate();
        const later = new Error('later cleanup failed');
        const attempted: number[] = [];
        let thrown: unknown;

        try {
            runRestorationActions([
                () => {
                    attempted.push(1);
                    throw hostile;
                },
                () => {
                    attempted.push(2);
                },
                () => {
                    attempted.push(3);
                    throw later;
                },
            ]);
        } catch (error) {
            thrown = error;
        }

        expect(attempted).toEqual([1, 2, 3]);
        const errors = aggregatedErrors(thrown);
        expect(errors).toHaveLength(2);
        expect(opaqueWrapper(errors[0]).cause).toBe(hostile);
        expect(errors[1]).toBe(later);
    });

    it('records a failure nested past the inspection stack limit', () => {
        let deep = new AggregateError([new Error('leaf')], 'deep');
        for (let level = 0; level < 25000; level += 1) {
            deep = new AggregateError([deep], 'deep');
        }
        const marked: Error[] = [];
        const scope = new RestorationScope(failure => {
            marked.push(failure);
        });

        expect(() => {
            scope.recordFailure(deep);
        }).not.toThrow();
        expect(() => {
            scope.throwIfFailed();
        }).toThrow(Error);
        expect(marked).toHaveLength(1);
    });
});

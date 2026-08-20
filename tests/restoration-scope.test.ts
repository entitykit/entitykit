import {
    restorationFailureFrom,
    runRestorationActions,
} from '../packages/core/src/restoration-actions';
import { RestorationScope } from '../packages/core/src/restoration-scope';

describe('restoration scope', () => {
    it('runs every action and aggregates exact cleanup failures', () => {
        const first = new Error('first');
        const second = new Error('second');
        const attempted: number[] = [];

        let failure: unknown;
        try {
            runRestorationActions([
                () => {
                    attempted.push(1);
                    throw new AggregateError([first]);
                },
                () => {
                    attempted.push(2);
                    throw second;
                },
                () => {
                    attempted.push(3);
                },
            ]);
        } catch (error) {
            failure = error;
        }
        expect(attempted).toEqual([1, 2, 3]);
        expect(failure).toBeInstanceOf(AggregateError);
        expect((failure as AggregateError).errors).toEqual([first, second]);
        expect((failure as Error).message)
            .toBe('Multiple context state restoration phases failed.');
    });

    it('wraps one primitive cleanup failure without losing its cause', () => {
        const failure = restorationFailureFrom([null]);
        expect(failure).toBeInstanceOf(Error);
        expect(failure?.cause).toBeNull();
        expect(failure?.message).toBe('Context state restoration failed.');
        expect(restorationFailureFrom([])).toBeUndefined();
    });

    it('flattens nested cleanup aggregates before poisoning', () => {
        const marked: Error[] = [];
        const first = new Error('first');
        const second = new Error('second');
        const scope = new RestorationScope(error => {
            marked.push(error);
        });
        scope.recordFailure(new AggregateError([
            new AggregateError([first]), second,
        ]));

        expect(() => {
            scope.throwIfFailed();
        }).toThrow(AggregateError);
        expect(marked).toHaveLength(1);
        expect((marked[0] as AggregateError).errors).toEqual([first, second]);
    });

    it('retains empty aggregate cleanup failures', () => {
        const empty = new AggregateError([], 'empty cleanup failed');
        expect(() => {
            runRestorationActions([
                () => {
                    throw empty;
                },
            ]);
        }).toThrow(empty);

        const marked = jest.fn();
        const scope = new RestorationScope(marked);
        scope.recordFailure(empty);
        expect(() => {
            scope.throwIfFailed();
        }).toThrow(empty);
        expect(marked).toHaveBeenCalledWith(empty);
    });

    it('terminates cyclic aggregate flattening without losing the failure', () => {
        const cyclic = new AggregateError([], 'cyclic cleanup failed');
        (cyclic.errors as unknown[]).push(cyclic);

        expect(() => {
            runRestorationActions([
                () => {
                    throw cyclic;
                },
            ]);
        }).toThrow(cyclic);

        const scope = new RestorationScope(() => undefined);
        scope.recordFailure(cyclic);
        expect(() => {
            scope.throwIfFailed();
        }).toThrow(cyclic);
    });

    it('poisons once and rethrows an exact undefined primary value', () => {
        const marked: Error[] = [];
        const markFailure = jest.fn((failure: Error) => {
            marked.push(failure);
        });
        const scope = new RestorationScope(markFailure);
        const cleanup = new Error('cleanup');
        scope.capturePrimary(undefined);
        scope.recordFailure(cleanup);

        let rejected = false;
        let primary: unknown;
        try {
            scope.rethrowPrimary();
        } catch (error) {
            rejected = true;
            primary = error;
        }
        expect(rejected).toBe(true);
        expect(primary).toBeUndefined();
        expect(markFailure).toHaveBeenCalledTimes(1);
        expect(markFailure).toHaveBeenCalledWith(cleanup);
        expect(marked).toEqual([cleanup]);
    });

    it('keeps the first primary and rejects a missing primary', () => {
        const scope = new RestorationScope(() => undefined);
        expect(() => {
            scope.rethrowPrimary();
        }).toThrow('Restoration scope has no primary failure.');
        scope.capturePrimary('first');
        scope.capturePrimary('second');
        let primary: unknown;
        try {
            scope.rethrowPrimary();
        } catch (error) {
            primary = error;
        }
        expect(primary).toBe('first');
    });

    it('throws and records cleanup failure when no primary operation failed', () => {
        const markFailure = jest.fn((failure: Error) => {
            expect(failure).toBeInstanceOf(Error);
        });
        const scope = new RestorationScope(markFailure);
        const cleanup = new Error('cleanup');
        scope.attempt(() => {
            throw cleanup;
        });

        expect(() => {
            scope.throwIfFailed();
        }).toThrow(cleanup);
        expect(markFailure).toHaveBeenCalledWith(cleanup);
        expect(() => {
            scope.throwIfFailed();
        }).toThrow(cleanup);
        expect(markFailure).toHaveBeenCalledTimes(1);
    });
});

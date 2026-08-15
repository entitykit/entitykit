import { SavePlanBuilder } from '../src/core/save-plan-builder';
import { RestorationScope } from '../src/restoration-scope';
import type { SaveTimeWrites } from '../src/core/save-time-writes';
import type { SavePlanBuilderDeps } from '../src/core/save-plan-builder';

function builderWithFailure(failure: unknown): {
    readonly builder: SavePlanBuilder;
    readonly begin: jest.Mock;
    readonly beginGeneration: jest.Mock;
    readonly restore: jest.Mock;
} {
    const begin = jest.fn();
    const beginGeneration = jest.fn();
    const restore = jest.fn();
    const saveTimeWrites = {
        begin,
        beginGeneration,
        restore,
    } as unknown as SaveTimeWrites;
    const deps = {
        saveTimeWrites,
        changeTracker: {
            entries: () => {
                throw failure;
            },
        },
    } as unknown as SavePlanBuilderDeps;
    return {
        builder: new SavePlanBuilder(deps),
        begin,
        beginGeneration,
        restore,
    };
}

describe('save plan attempt scope', () => {
    it('begins a fresh scope for ordinary planning', () => {
        const failure = new Error('capture failed');
        const value = builderWithFailure(failure);

        expect(() => value.builder.build(
            new RestorationScope(() => undefined),
        )).toThrow(failure);
        expect(value.begin).toHaveBeenCalledTimes(1);
        expect(value.beginGeneration).not.toHaveBeenCalled();
        expect(value.restore).toHaveBeenCalledTimes(1);
    });

    it('retains the scope only for an interceptor rebuild', () => {
        const failure = new Error('capture failed');
        const value = builderWithFailure(failure);

        expect(() => value.builder.build(
            new RestorationScope(() => undefined),
            { continueSaveAttempt: true },
        )).toThrow(failure);
        expect(value.begin).not.toHaveBeenCalled();
        expect(value.beginGeneration).toHaveBeenCalledTimes(1);
        expect(value.restore).toHaveBeenCalledTimes(1);
    });
});

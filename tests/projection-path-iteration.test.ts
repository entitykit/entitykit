import { materializeProjectionRows } from '../packages/core/src/core/projection-row-materializer';
import { createQueryModel } from '../packages/core/src/query/query-model';

function project(path: readonly string[]): Record<string, unknown> {
    const model = {
        ...createQueryModel(class Row {}),
        projection: [{ kind: 'literal' as const, alias: 'raw', path, value: 42 }],
    };
    return materializeProjectionRows(model, [{ raw: 42 }], () => {
        throw new Error('Literal projections must not read a mapped field.');
    })[0];
}

describe('projection path iteration', () => {
    it('does not invent a property for an empty or entirely sparse path', () => {
        expect(Object.keys(project([]))).toEqual([]);
        expect(Object.keys(project(new Array<string>(1)))).toEqual([]);
    });

    it('skips holes without changing the index of the leaf', () => {
        const path = ['outer', 'unused', 'value'];
        Reflect.deleteProperty(path, 1);
        expect(project(path)).toEqual({ outer: { value: 42 } });
        Reflect.deleteProperty(path, 2);
        expect(project(path)).toEqual({ outer: {} });
    });

    it('ignores appended segments beyond the initial iteration length', () => {
        const path = ['outer'];
        Object.defineProperty(path, 0, {
            get: () => {
                path.push('appended');
                return 'outer';
            },
        });
        // The live path length makes the original segment an ancestor, but
        // iteration still stops at its captured starting length.
        expect(project(path)).toEqual({ outer: {} });
    });

    it('observes deleted segments and the current leaf position', () => {
        const path = ['outer', 'removed'];
        Object.defineProperty(path, 0, {
            get: () => {
                path.length = 1;
                return 'outer';
            },
        });
        expect(project(path)).toEqual({ outer: 42 });
    });
});

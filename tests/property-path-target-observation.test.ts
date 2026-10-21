import {
    propertyValueTarget,
    writePropertyPath,
} from '../packages/core/src/model/property-value-access';

function visit(mode: 'write' | 'target', row: object, path: string[]): void {
    if (mode === 'write') {
        writePropertyPath(row, path, 42);
    } else {
        const resolved = propertyValueTarget(row, path);
        Reflect.set(resolved.target, resolved.propertyName, 42);
    }
}

describe('property path target observations', () => {
    it.each(['write', 'target'] as const)('captures the leaf before custom slice observations for %s', mode => {
        const events: string[] = [];
        const path = ['captured'];
        const row = {};
        Object.defineProperty(path, 'at', { value: function (this: string[], index: number) {
            expect(this).toBe(path);
            expect(index).toBe(-1);
            events.push('leaf');
            return 'captured';
        } });
        Object.defineProperty(path, 'slice', { value: function (this: string[], start: number, end: number) {
            expect(this).toBe(path);
            expect([start, end]).toEqual([0, -1]);
            events.push('slice');
            path[0] = 'changed';
            Object.setPrototypeOf(row, { set captured(value: number) {
                expect(this).toBe(row);
                events.push(`write:${String(value)}`);
            } });
            return [];
        } });
        visit(mode, row, path);
        expect(events).toEqual(['leaf', 'slice', 'write:42']);
        expect(Object.hasOwn(row, 'changed')).toBe(false);
    });

    it.each(['write', 'target'] as const)('rejects the leaf before invoking custom slice for %s', mode => {
        const path = ['value'];
        Object.defineProperty(path, 'at', { value: () => '' });
        const sliced = jest.fn(() => []);
        Object.defineProperty(path, 'slice', { value: sliced });
        expect(() => {
            visit(mode, {}, path);
        })
            .toThrow('Mapped property paths must contain at least one segment.');
        expect(sliced).not.toHaveBeenCalled();
    });

    it.each(['write', 'target'] as const)('observes the returned ancestor iterator before entity traversal for %s', mode => {
        const events: string[] = [];
        const target = { value: 0 };
        const row = { get scope() {
            events.push('get scope');
            return target;
        } };
        const path = ['ignored', 'value'];
        Object.defineProperty(path, 'slice', { value: () => ({
            *[Symbol.iterator]() {
                events.push('iterator');
                yield 'scope';
                events.push('done');
            },
        }) });
        visit(mode, row, path);
        expect(target.value).toBe(42);
        expect(events).toEqual(['iterator', 'get scope', 'done']);
    });

    it('returns the created target even when an ancestor setter stores a different object', () => {
        const replacement = {};
        let assigned: object | undefined;
        const row = { get scope(): object | undefined {
            return undefined;
        },
        set scope(value: object | undefined) {
            assigned = value;
            Object.defineProperty(this, 'scope', { value: replacement });
        },
        };
        const result = propertyValueTarget(row, ['scope', 'value']);
        expect(result.target).toBe(assigned);
        expect(result.target).not.toBe(replacement);
        expect(result.target).toEqual({});
        expect(result.propertyName).toBe('value');
        expect(row.scope).toBe(replacement);
    });
});

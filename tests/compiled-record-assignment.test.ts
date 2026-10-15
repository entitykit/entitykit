import { cloneUnconvertedEntityValues } from '../packages/core/src/materialization/compiled-entity-values';

describe('compiled model-record assignment observations', () => {
    it.each(['retentionFirst', 'retentionTail'])(
        'observes an inherited %s setter installed by a nested clone', key => {
            const receivers: object[] = [];
            const observedKeys: string[][] = [];
            const assigned: unknown[] = [];
            const source = {
                retentionFirst: {
                    get nested(): number {
                        Object.defineProperty(Object.prototype, key, {
                            configurable: true,
                            set(this: object, value: unknown) {
                                receivers.push(this);
                                observedKeys.push(Object.keys(this));
                                assigned.push(value);
                            },
                        });
                        return 1;
                    },
                },
                retentionTail: 7,
            };
            let copy: Record<string, unknown>;
            try {
                copy = cloneUnconvertedEntityValues(source);
            } finally {
                Reflect.deleteProperty(Object.prototype, key);
            }
            expect(receivers).toEqual([copy]);
            expect(observedKeys).toEqual(key === 'retentionFirst' ? [[]] : [['retentionFirst']]);
            expect(assigned).toEqual(key === 'retentionFirst' ? [{ nested: 1 }] : [7]);
            expect(Object.hasOwn(copy, key)).toBe(false);
            expect(Object.keys(copy)).toEqual(key === 'retentionFirst' ? ['retentionTail'] : ['retentionFirst']);
            expect(Object.keys(source)).toEqual(['retentionFirst', 'retentionTail']);
            expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
        },
    );

    it('preserves a late inherited read-only property failure and subsequent recovery', () => {
        const events: string[] = [];
        const source = {
            first: {
                get nested(): number {
                    events.push('nested clone');
                    Object.defineProperty(Object.prototype, 'retentionTail', {
                        configurable: true, value: 9, writable: false,
                    });
                    return 1;
                },
            },
            get retentionTail(): number {
                events.push('root tail');
                return 7;
            },
        };
        let failure: unknown;
        try {
            cloneUnconvertedEntityValues(source);
        } catch (error) {
            failure = error;
        } finally {
            Reflect.deleteProperty(Object.prototype, 'retentionTail');
        }
        expect(failure).toBeInstanceOf(TypeError);
        expect(events).toEqual(['root tail', 'nested clone']);
        const graph = { nested: 1 };
        const recovered = cloneUnconvertedEntityValues({ first: graph, retentionTail: 7 });
        expect(recovered).toEqual({ first: { nested: 1 }, retentionTail: 7 });
        expect(recovered.first).not.toBe(graph);
    });
});

import { materializeProjectionRows } from '../packages/core/src/core/projection-row-materializer';
import { createQueryModel } from '../packages/core/src/query/query-model';

// Ancestor reads can invoke inherited getters before the own-property check.
// Those getters receive the result root and can alter its later descriptors.
describe('projection root exposed by an ancestor getter', () => {
    it.each(['accessor', 'readonly', 'prototype'] as const)(
        'keeps define semantics after a getter changes %s behavior', kind => {
            const key = '__entitykitProjectionExposedRoot';
            const exposed: Array<Record<string, unknown>> = [];
            let setterCalls = 0;
            let expectedPrototype = Object.prototype;
            const accessor = {
                configurable: true,
                get: () => -1,
                set: () => {
                    setterCalls++;
                },
            };
            Object.defineProperty(Object.prototype, key, {
                configurable: true,
                get: function (this: Record<string, unknown>): undefined {
                    exposed.push(this);
                    if (kind === 'prototype') {
                        expectedPrototype = Object.create(Object.prototype) as object;
                        Object.defineProperty(expectedPrototype, 'later', accessor);
                        Object.setPrototypeOf(this, expectedPrototype);
                    } else {
                        Object.defineProperty(this, 'later', kind === 'accessor'
                            ? accessor
                            : { configurable: true, writable: false, value: -1 });
                    }
                    return undefined;
                },
            });
            try {
                const model = {
                    ...createQueryModel(class Row {}),
                    projection: [
                        { kind: 'field' as const, alias: 'nested', propertyName: 'nested', path: [key, 'value'] },
                        { kind: 'field' as const, alias: 'later', propertyName: 'later' },
                    ],
                };
                const [result] = materializeProjectionRows(model,
                    [{ nested: 1, later: 42 }], (_source, _name, value) => value);
                expect(exposed).toHaveLength(1);
                expect(result).toBe(exposed[0]);
                expect(Object.getPrototypeOf(result)).toBe(expectedPrototype);
                expect(result[key]).toEqual({ value: 1 });
                expect(setterCalls).toBe(0);
                expect(Object.getOwnPropertyDescriptor(result, 'later')).toEqual({
                    configurable: true, enumerable: true, writable: true, value: 42,
                });
            } finally {
                Reflect.deleteProperty(Object.prototype, key);
            }
        },
    );
});

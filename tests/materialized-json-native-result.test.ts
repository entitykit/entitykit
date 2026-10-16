import { Materializer } from '../packages/core/src/experimental';
import { entityReadMetadata } from './support/compiled-entity';

describe.each([false, true])('JSON native result validation, compiled=%s', compiled => {
    it.each(['prototype', 'keys'])('reports %s failures after the complete second source copy', trap => {
        const events: string[] = [];
        const bytes = new Uint8Array([1]);
        Object.defineProperty(bytes, 'constructor', { value: function (): object {
            events.push('construct');
            return new Proxy({ value: 1 }, {
                getPrototypeOf(target): object | null {
                    events.push('prototype');
                    if (trap === 'prototype') throw new Error('native result prototype failed');
                    return Reflect.getPrototypeOf(target);
                },
                ownKeys(target): Array<string | symbol> {
                    events.push('keys');
                    if (trap === 'keys') throw new Error('native result keys failed');
                    return Reflect.ownKeys(target);
                },
            });
        } });
        const source = { bytes, get tail() {
            events.push('tail');return 2; 
        } };
        const metadata = entityReadMetadata(compiled, undefined, 'jsonb');
        expect(() => new Materializer().materializeUntracked(metadata, {
            id: 1, stored_value: source, tail: 3,
        })).toThrow('\'PlannedRow.value.bytes\' (property inspection failed)');
        expect(events).toEqual([
            'construct', 'tail', 'construct', 'tail', 'prototype', ...trap === 'keys' ? ['keys'] : [],
        ]);
    });
});

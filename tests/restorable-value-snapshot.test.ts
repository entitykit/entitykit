import { valueConverter } from '../packages/core/src';
import { ModelBuilder } from '../packages/core/src/model/model-builder';
import { requireDefined } from './support/require-defined';
import {
    isImmutablePrimitiveValue,
    snapshotRestorablePropertyValue,
    snapshotRestorableValue,
} from '../packages/core/src/tracking/restorable-value-snapshot';

describe('rollback value snapshots', () => {
    it.each([null, undefined, false, 0, -0, 1n, NaN, 'text', Symbol('key')])(
        'recognizes immutable primitive %p', value => {
            expect(isImmutablePrimitiveValue(value)).toBe(true);
        },
    );

    it.each([{}, [], new Date(0), new Map(), new Set(), () => 'value'])(
        'requires a model snapshot for a mutable or callable value %p', value => {
            expect(isImmutablePrimitiveValue(value)).toBe(false);
        },
    );

    it('preserves a primitive pre-image without normalizing it through a converter', () => {
        const toProvider = jest.fn((value: string) => value.trim());
        const fromProvider = jest.fn((value: string) => value);
        const converter = valueConverter({ toProvider, fromProvider });

        expect(snapshotRestorableValue(' before ', converter)).toBe(' before ');
        expect(toProvider).not.toHaveBeenCalled();
        expect(fromProvider).not.toHaveBeenCalled();
    });

    it('reconstructs a callable model value independently of its mutable closure', () => {
        let current = 'before';
        const original = (): string => current;
        const converter = valueConverter<() => string, string>({
            toProvider: value => value(),
            fromProvider: value => () => value,
        });
        const snapshot = snapshotRestorableValue(original, converter) as () => string;
        current = 'after';

        expect(original()).toBe('after');
        expect(snapshot()).toBe('before');
        expect(snapshot).not.toBe(original);
    });

    it('copies an unmapped object pre-image without requiring property metadata', () => {
        const metadata = requireDefined(new ModelBuilder().entity(RollbackRow, entity => {
            entity.toTable('rollback_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text');
        }).build().entities[0]);
        const original = { nested: { value: 'before' } };
        const snapshot = snapshotRestorablePropertyValue(metadata, 'auxiliary', original);
        original.nested.value = 'after';

        expect(snapshot).toEqual({ nested: { value: 'before' } });
        expect(snapshot).not.toBe(original);
    });

    it('identifies the mapped property when a converter returns an asynchronous pre-image', () => {
        const converter = valueConverter<object, string>({
            toProvider: () => Promise.resolve('invalid') as unknown as string,
            fromProvider: value => ({ value }),
        });
        const metadata = requireDefined(new ModelBuilder().entity(RollbackRow, entity => {
            entity.toTable('rollback_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text');
            entity.property(row => row.value).hasColumnType('text').hasConversion(converter);
        }).build().entities[0]);

        expect(() => snapshotRestorablePropertyValue(metadata, 'value', {}))
            .toThrow('Value converter for \'RollbackRow.value\' toProvider() must be synchronous');
    });
});

class RollbackRow {
    public id = '';
    public value: object = {};
}

import type { PropertyMetadata } from '../src/model/property-metadata';
import { SaveTimeMutationLog } from '../src/core/save-time-mutations';

interface ByteEntity {
    value: Uint8Array;
}

const property: PropertyMetadata<ByteEntity, Uint8Array> = {
    propertyName: 'value',
    propertyPath: ['value'],
    columnName: 'value',
    columnType: 'blob',
    isRequired: true,
    isPrimaryKey: false,
    isUnique: false,
    isConcurrencyToken: false,
    isVersion: false,
};

describe('save-time property mutation log', () => {
    it('restores a semantically equal byte-array policy value', () => {
        const previous = new Uint8Array([1, 2]);
        const entity: ByteEntity = { value: new Uint8Array([3, 4]) };
        const log = new SaveTimeMutationLog();
        log.recordApplied(
            entity,
            property,
            previous,
            entity.value,
            'ByteEntity.value',
        );
        entity.value = new Uint8Array([3, 4]);

        log.restore();

        expect(entity.value).toBe(previous);
    });

    it('preserves an in-place application mutation of the policy value', () => {
        const previous = new Uint8Array([1, 2]);
        const applied = new Uint8Array([3, 4]);
        const entity: ByteEntity = { value: applied };
        const log = new SaveTimeMutationLog();
        log.recordApplied(
            entity,
            property,
            previous,
            applied,
            'ByteEntity.value',
        );
        applied[0] = 9;

        log.restore();

        expect(entity.value).toBe(applied);
        expect([...entity.value]).toEqual([9, 4]);
    });

    it('attempts every restoration before reporting the first failure', () => {
        const failure = new Error('restore failed');
        const values: Record<string, unknown> = {
            good: 'before-good',
            bad: 'before-bad',
        };
        const log = new SaveTimeMutationLog();
        log.record(values, 'good');
        log.record(values, 'bad');
        values.good = 'after-good';
        Object.defineProperty(values, 'bad', {
            configurable: true,
            get: () => 'after-bad',
            set: () => {
                throw failure;
            },
        });

        expect(() => {
            log.restore();
        }).toThrow(failure);

        expect(values.good).toBe('before-good');
        expect(values.bad).toBe('after-bad');
    });
});

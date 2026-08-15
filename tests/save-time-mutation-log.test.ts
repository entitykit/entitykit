import type { PropertyMetadata } from '../src/model/property-metadata';
import { SaveTimeMutationLog } from '../src/core/save-time-mutations';
import { restoreGenerationNavigation } from '../src/core/save-time-relationship-generation-values';

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

interface NestedEntity {
    details: { value: string };
}

const nestedProperty: PropertyMetadata<NestedEntity, string> = {
    ...property,
    propertyName: 'details.value',
    propertyPath: ['details', 'value'],
    columnType: 'text',
} as PropertyMetadata<NestedEntity, string>;

describe('save-time property mutation log', () => {
    it('restores a generated collection in place and reconnects its reference', () => {
        const first = {};
        const second = {};
        const previous = [first, second];
        const snapshot = [...previous];
        previous.splice(0, previous.length, {});
        const entity: Record<string, unknown> = { children: [{}] };

        restoreGenerationNavigation(entity, {
            property: 'children',
            value: previous,
            snapshot,
        });

        expect(entity.children).toBe(previous);
        expect(previous).toEqual([first, second]);
    });

    it('does not treat a mismatched checkpoint as an array snapshot', () => {
        const previous: unknown[] = [{}];
        const entity: Record<string, unknown> = { children: [{}] };

        expect(() => {
            restoreGenerationNavigation(entity, {
                property: 'children', value: previous, snapshot: null,
            });
        }).not.toThrow();
        expect(entity.children).toBe(previous);
    });

    it('restores a generated scalar navigation without array mutation', () => {
        const previous = {};
        const entity: Record<string, unknown> = { parent: {} };

        restoreGenerationNavigation(entity, {
            property: 'parent', value: previous, snapshot: previous,
        });

        expect(entity.parent).toBe(previous);
    });

    it('restores a semantically equal byte-array policy value', () => {
        const previous = new Uint8Array([1, 2]);
        const entity: ByteEntity = { value: new Uint8Array([3, 4]) };
        const log = new SaveTimeMutationLog();
        const restored = jest.fn((value: boolean) => value);
        log.recordApplied(
            entity,
            property,
            previous,
            entity.value,
            'ByteEntity.value',
            restored,
        );
        entity.value = new Uint8Array([3, 4]);

        log.restore();

        expect(entity.value).toBe(previous);
        expect(restored).toHaveBeenCalledWith(true);
    });

    it('preserves an in-place application mutation of the policy value', () => {
        const previous = new Uint8Array([1, 2]);
        const applied = new Uint8Array([3, 4]);
        const entity: ByteEntity = { value: applied };
        const log = new SaveTimeMutationLog();
        const restored = jest.fn((value: boolean) => value);
        log.recordApplied(
            entity,
            property,
            previous,
            applied,
            'ByteEntity.value',
            restored,
        );
        applied[0] = 9;

        log.restore();

        expect(entity.value).toBe(applied);
        expect([...entity.value]).toEqual([9, 4]);
        expect(restored).toHaveBeenCalledWith(false);
    });

    it('restores a nested value while its captured ancestor remains live', () => {
        const entity: NestedEntity = { details: { value: 'applied' } };
        const log = new SaveTimeMutationLog();
        log.recordApplied(
            entity, nestedProperty, 'before', 'applied',
            'NestedEntity.details.value',
        );

        log.restore();

        expect(entity.details.value).toBe('before');
    });

    it('does not write through a replacement ancestor during rollback', () => {
        const entity: NestedEntity = { details: { value: 'applied' } };
        const log = new SaveTimeMutationLog();
        log.recordApplied(
            entity, nestedProperty, 'before', 'applied',
            'NestedEntity.details.value',
        );
        const replacement = { value: 'applied' };
        entity.details = replacement;

        log.restore();

        expect(entity.details).toBe(replacement);
        expect(replacement.value).toBe('applied');
    });

    it('attempts every restoration before reporting the first failure', () => {
        const failure = new Error('restore failed');
        const order: string[] = [];
        const log = new SaveTimeMutationLog();
        log.recordRestoration(() => {
            order.push('first');
        });
        log.recordRestoration(() => {
            order.push('second');
            throw failure;
        });

        expect(() => {
            log.restore();
        }).toThrow(failure);

        expect(order).toEqual(['second', 'first']);
    });
});

import { writeFailureAtomicProperty } from '../src/failure-atomic-property-write';
import { ModelBuilder } from '../src/model/model-builder';
import { RestorationScope } from '../src/restoration-scope';

class AtomicWriteRow {
    public value = 'before';
}

const metadata = new ModelBuilder().entity(AtomicWriteRow, entity => {
    entity.toTable('atomic_write_rows');
    entity.hasKey(row => row.value);
    entity.property(row => row.value).hasColumnType('text').isRequired();
}).build().getEntity(AtomicWriteRow);

describe('failure atomic property write', () => {
    it('supports a successful write without a long-lived journal callback', () => {
        const row = new AtomicWriteRow();
        const scope = new RestorationScope(() => undefined);

        expect(writeFailureAtomicProperty({
            entity: row,
            property: metadata.getProperty('value'),
            value: 'after',
            scope,
        })).toBe('after');
        expect(row.value).toBe('after');
    });

    it('uses the property name when reporting silent rollback refusal', () => {
        let stored = 'before';
        const row = new AtomicWriteRow();
        Object.defineProperty(row, 'value', {
            get: () => stored,
            set: (value: string) => {
                if (value !== 'before') stored = value;
            },
        });
        const scope = new RestorationScope(() => undefined);
        const primary = new Error('journal failed');

        expect(() => writeFailureAtomicProperty({
            entity: row,
            property: metadata.getProperty('value'),
            value: 'after',
            scope,
            recordApplied: () => {
                throw primary;
            },
        })).toThrow(primary);
        expect(() => {
            scope.rethrowPrimary();
        }).toThrow(primary);
        expect(() => {
            scope.throwIfFailed();
        }).toThrow('Property \'value\' refused its restoration value.');
    });
});

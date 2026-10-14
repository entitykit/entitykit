import { applyMaterializedValues } from '../packages/core/src/materialization/complex-value-materializer';
import { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import { RestorationScope } from '../packages/core/src/restoration-scope';

class ContextRow {
    public value: unknown = 'before';
}

function fixture(path = ['value']): EntityMetadata<ContextRow> {
    return new EntityMetadata({
        ctor: ContextRow, tableName: 'rows', isKeyless: true,
        properties: [{
            propertyName: 'value', propertyPath: path, columnName: 'value',
            columnType: 'text', isRequired: false, isPrimaryKey: false,
            isUnique: false, isConcurrencyToken: false, isVersion: false,
        }],
    });
}

function refuse(row: object, onWrite = (): void => undefined): void {
    Object.defineProperty(row, 'value', {
        get: () => 'before', set: onWrite,
    });
}

describe('materialized write diagnostic observations', () => {
    it('reads diagnostic names before the live value key and preserves successful writes', () => {
        const metadata = fixture();
        const events: string[] = [];
        Object.defineProperty(metadata, 'entityName', { get: () => {
            events.push('entity');
            return 'Original';
        } });
        let names = 0;
        Object.defineProperty(metadata.properties[0], 'propertyName', { get: () => {
            events.push('name');
            return ++names === 1 ? 'diagnostic' : 'value';
        } });
        const row = new ContextRow();
        applyMaterializedValues(metadata, row, { get value() {
            events.push('value');
            return 'after';
        } });
        expect(row.value).toBe('after');
        expect(events).toEqual(['entity', 'name', 'name', 'value']);
    });

    it.each([false, true])('captures names before value reads and setters, restoration %s', restore => {
        const metadata = fixture();
        let name = 'Original';
        Object.defineProperty(metadata, 'entityName', { get: () => name });
        let reads = 0;
        Object.defineProperty(metadata.properties[0], 'propertyName', {
            get: () => ++reads === 1 ? 'diagnostic' : 'value',
        });
        const row = new ContextRow();
        refuse(row, () => {
            name = 'Setter';
        });
        const scope = restore ? new RestorationScope(() => undefined) : undefined;
        expect(() => {
            applyMaterializedValues(metadata, row, { get value() {
                name = 'ValueGetter';
                return 'after';
            } }, scope);
        }).toThrow('Property \'Original.diagnostic\' refused its assigned value.');
        expect(name).toBe('Setter');
    });

    it('observes a throwing entity-name getter before reading the property or value', () => {
        const metadata = fixture();
        Object.defineProperty(metadata, 'entityName', { get: () => {
            throw new Error('name failed');
        } });
        const name = jest.fn(() => 'value');
        Object.defineProperty(metadata.properties[0], 'propertyName', { get: name });
        const value = jest.fn(() => 'after');
        const values = Object.defineProperty({}, 'value', { get: value });
        expect(() => {
            applyMaterializedValues(metadata, new ContextRow(), values);
        })
            .toThrow('name failed');
        expect(name).not.toHaveBeenCalled();
        expect(value).not.toHaveBeenCalled();
    });

    it('preserves name coercion before the next metadata or value observation', () => {
        const metadata = fixture();
        const events: string[] = [];
        Object.defineProperty(metadata, 'entityName', { get: () => ({ toString: () => {
            events.push('entity coercion');
            return 'Original';
        } }) });
        Object.defineProperty(metadata.properties[0], 'propertyName', { get: () => {
            events.push('name getter');
            return { toString: () => {
                events.push('name coercion');
                return 'value';
            } };
        } });
        applyMaterializedValues(metadata, new ContextRow(), { value: 'after' });
        expect(events).toEqual([
            'entity coercion', 'name getter', 'name coercion', 'name getter', 'name coercion',
        ]);
    });

    it.each(['', 'value'])('keeps the diagnostic separator for property name %p', name => {
        const metadata = fixture();
        Object.defineProperty(metadata, 'entityName', { value: '' });
        Object.defineProperty(metadata.properties[0], 'propertyName', { value: name });
        const row = new ContextRow();
        refuse(row);
        expect(() => {
            applyMaterializedValues(metadata, row, { [name]: 'after' });
        })
            .toThrow(`Property '.${name}' refused its assigned value.`);
    });

    it.each([false, true])('uses captured names for provider comparison errors, object input %s', object => {
        const metadata = fixture();
        let name = 'Original';
        Object.defineProperty(metadata, 'entityName', { get: () => name });
        Object.defineProperty(metadata.properties[0], 'converter', { value: {
            toProvider: () => ({ then: (): void => undefined }),
        } });
        const row = new ContextRow();
        Object.defineProperty(row, 'value', {
            get: () => 'different', set: () => {
                name = 'Setter';
            },
        });
        expect(() => {
            applyMaterializedValues(metadata, row, {
                value: object ? { id: 1 } : 'after',
            });
        }).toThrow('Value converter for \'Original.value\' toProvider() must be synchronous');
        expect(name).toBe(object ? 'Original' : 'Setter');
    });

    it('restores a partial setter write and retains its primary failure in the scope', () => {
        const metadata = fixture();
        const row = new ContextRow();
        let stored: unknown = 'before';
        const primary = new Error('setter failed after writing');
        Object.defineProperty(row, 'value', {
            get: () => stored,
            set: (value: unknown) => {
                stored = value;
                if (value === 'after') throw primary;
            },
        });
        const poisoned = jest.fn();
        const scope = new RestorationScope(poisoned);
        expect(() => {
            applyMaterializedValues(metadata, row, { value: 'after' }, scope);
        }).toThrow(primary);
        expect(row.value).toBe('before');
        expect(() => {
            scope.rethrowPrimary();
        }).toThrow(primary);
        expect(() => {
            scope.throwIfFailed();
        }).not.toThrow();
        expect(poisoned).not.toHaveBeenCalled();
    });

    it('uses captured names when a nested ancestor refuses a write', () => {
        const metadata = fixture(['detail', 'value']);
        const row = new ContextRow();
        Object.defineProperty(row, 'detail', { get: () => null, set: () => undefined });
        expect(() => {
            applyMaterializedValues(metadata, row, { value: 'after' });
        })
            .toThrow('Property \'ContextRow.value\' refused its assigned value.');
    });
});

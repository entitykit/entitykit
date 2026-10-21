import { applyMaterializedValues } from '../packages/core/src/materialization/complex-value-materializer';
import { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import type { ComplexPropertyMetadata } from '../packages/core/src/model/complex-property-metadata';

class Row {
    public detail: { value?: string } | null = null;
}

function ancestor(name: string): ComplexPropertyMetadata {
    return { propertyName: name, propertyPath: [name], isRequired: false };
}

function apply(ancestors: readonly ComplexPropertyMetadata[], row = new Row()): Row {
    const metadata = new EntityMetadata({
        ctor: Row,
        tableName: 'rows',
        isKeyless: true,
        properties: [{
            propertyName: 'detail.value', propertyPath: ['detail', 'value'],
            columnName: 'value', columnType: 'text', isRequired: false,
            isPrimaryKey: false, isUnique: false, isConcurrencyToken: false, isVersion: false,
        }],
    });
    let reads = 0;
    // Isolate the ancestor-check phase from the preceding complex-construction phase.
    Object.defineProperty(metadata, 'complexProperties', {
        get: () => ++reads === 1 ? [] : ancestors,
    });
    applyMaterializedValues(metadata, row, { 'detail.value': 'after' });
    return row;
}

describe('complex ancestor iteration during materialization', () => {
    it('writes through an absent ancestor list and skips a mapped null ancestor', () => {
        expect(apply([]).detail).toEqual({ value: 'after' });
        expect(apply([ancestor('detail')]).detail).toBeNull();
    });

    it('skips holes but observes inherited ancestor indices', () => {
        const ancestors: ComplexPropertyMetadata[] = [];
        ancestors.length = 2;
        expect(apply(ancestors).detail).toEqual({ value: 'after' });
        const prototype = Object.create(Array.prototype) as ComplexPropertyMetadata[];
        Object.defineProperty(prototype, '1', { value: ancestor('detail') });
        Object.setPrototypeOf(ancestors, prototype);
        expect(apply(ancestors).detail).toBeNull();
    });

    it('does not visit ancestors appended after iteration starts', () => {
        const ancestors: ComplexPropertyMetadata[] = [];
        Object.defineProperty(ancestors, '0', {
            get: () => {
                ancestors.push(ancestor('detail'));
                return ancestor('other');
            },
        });
        expect(apply(ancestors).detail).toEqual({ value: 'after' });
        expect(ancestors).toHaveLength(2);
    });

    it('skips a later ancestor deleted by an earlier getter', () => {
        const ancestors = [ancestor('other'), ancestor('detail')];
        Object.defineProperty(ancestors, '0', {
            get: () => {
                Reflect.deleteProperty(ancestors, '1');
                return ancestor('other');
            },
        });
        expect(apply(ancestors).detail).toEqual({ value: 'after' });
    });

    it('stops before later getters after finding a null ancestor', () => {
        const ancestors = [ancestor('detail')];
        Object.defineProperty(ancestors, '1', {
            get: () => {
                throw new Error('must not read');
            },
        });
        expect(apply(ancestors).detail).toBeNull();
    });

    it('preserves live path observations before reading the entity ancestor', () => {
        const events: string[] = [];
        const complex: ComplexPropertyMetadata = {
            propertyName: 'detail', isRequired: false,
            get propertyPath() {
                events.push('path');
                return ['detail'];
            },
        };
        const row = new Row();
        Object.defineProperty(row, 'detail', {
            get: () => {
                events.push('entity');
                return null;
            },
        });
        apply([complex], row);
        expect(events).toEqual(['path', 'path', 'path', 'entity']);
    });

    it('propagates an ancestor getter failure before writing values', () => {
        const row = new Row();
        const ancestors: ComplexPropertyMetadata[] = [];
        const error = new Error('ancestor failed');
        Object.defineProperty(ancestors, '0', { get: () => {
            throw error;
        } });
        expect(() => apply(ancestors, row)).toThrow(error);
        expect(row.detail).toBeNull();
    });
});

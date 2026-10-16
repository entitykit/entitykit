import { applyMaterializedValues, ensureComplexPropertyPath } from '../packages/core/src/materialization/complex-value-materializer';
import { ModelBuilder } from '../packages/core/src/model/model-builder';
import { RestorationScope } from '../packages/core/src/restoration-scope';

interface Leaf { value?: number | null }
class Detail {
    public left?: Leaf | null;
    public right?: Leaf | null;
}
class BoundaryRow {
    public id = 0;
    public detail?: Detail | null;
    public other?: Detail | null;
    public required?: Leaf;
}

const metadata = new ModelBuilder().entity(BoundaryRow, entity => {
    entity.toTable('complex_boundary_rows');
    entity.hasKey(row => row.id);
    entity.property(row => row.id).hasColumnType('integer');
    entity.complexProperty(row => row.detail, { constructor: Detail }, detail => {
        detail.complexProperty(row => row.left, {}, leaf => {
            leaf.property(row => row.value).hasColumnType('integer').isOptional();
        });
        detail.complexProperty(row => row.right, {}, leaf => {
            leaf.property(row => row.value).hasColumnType('integer').isOptional();
        });
    });
    entity.complexProperty(row => row.other, { constructor: Detail }, detail => {
        detail.complexProperty(row => row.left, {}, leaf => {
            leaf.property(row => row.value).hasColumnType('integer').isOptional();
        });
    });
    entity.complexProperty(row => row.required, { required: true }, leaf => {
        leaf.property(row => row.value).hasColumnType('integer').isOptional();
    });
}).build().getEntity(BoundaryRow);

describe.each([false, true])('complex read boundaries, restoration=%s', restoring => {
    const scope = (): RestorationScope | undefined => restoring
        ? new RestorationScope(() => undefined) : undefined;

    it.each([null, undefined])('leaves optional ancestors null when every descendant is %p', absent => {
        const row = new BoundaryRow();
        applyMaterializedValues(metadata, row, {
            id: 7, 'detail.left.value': absent, 'detail.right.value': absent,
            'other.left.value': absent, 'required.value': absent,
        }, scope());

        expect(row.detail).toBeNull();
        expect(row.other).toBeNull();
        expect(row.required).toEqual({ value: absent });
        expect(Object.getPrototypeOf(row.required)).toBe(Object.prototype);
        expect(row.id).toBe(7);
    });

    it('writes a populated sibling without reviving a null complex ancestor', () => {
        const row = new BoundaryRow();
        applyMaterializedValues(metadata, row, {
            id: 8, 'detail.left.value': null, 'detail.right.value': 0,
            'other.left.value': null, 'required.value': 9,
        }, scope());

        expect(row.detail).toBeInstanceOf(Detail);
        expect(row.detail?.left).toBeNull();
        expect(row.detail?.right).toEqual({ value: 0 });
        expect(Object.getPrototypeOf(row.detail?.right)).toBe(Object.prototype);
        expect(row.other).toBeNull();
        expect(row.required).toEqual({ value: 9 });
    });
});

describe('complex path creation boundaries', () => {
    it.each([null, undefined])('creates only strict ancestors under a %p parent', absent => {
        const row = new BoundaryRow();
        Object.assign(row, { detail: absent });
        ensureComplexPropertyPath(metadata, row, ['detail', 'right', 'value']);
        const created = row.detail;

        expect(created).toBeInstanceOf(Detail);
        expect(created?.right).toEqual({});
        expect(Object.getPrototypeOf(created?.right)).toBe(Object.prototype);
        expect(created?.left).toBeUndefined();
        expect(row.other).toBeUndefined();
        expect(row.required).toBeUndefined();
        const first = created?.right;
        ensureComplexPropertyPath(metadata, row, ['detail', 'right', 'value']);
        expect(row.detail?.right).toBe(first);
    });

    it('requires every path segment to match and preserves existing ancestors', () => {
        const existing = Object.assign(new Detail(), { right: { value: 4 }, left: null });
        const row = Object.assign(new BoundaryRow(), { detail: existing, other: null });
        ensureComplexPropertyPath(metadata, row, ['other', 'left', 'value']);
        const created = (row as BoundaryRow).other;

        expect(created).toBeInstanceOf(Detail);
        expect(created?.left).toEqual({});
        expect(row.detail).toBe(existing);
        expect(row.detail.left).toBeNull();
        expect(row.detail.right).toEqual({ value: 4 });
        expect(row.required).toBeUndefined();
    });

    it('does not construct the complex object at the requested path itself', () => {
        const row = new BoundaryRow();
        ensureComplexPropertyPath(metadata, row, ['detail', 'right']);

        expect(row.detail).toBeInstanceOf(Detail);
        expect(row.detail?.right).toBeUndefined();
        expect(row.detail?.left).toBeUndefined();
        expect(row.other).toBeUndefined();
    });

    it('reports the complete nested path when a setter refuses the created value', () => {
        const detail = new Detail();
        Object.defineProperty(detail, 'right', { get: () => null, set: () => undefined });
        const row = Object.assign(new BoundaryRow(), { detail });

        expect(() => {
            ensureComplexPropertyPath(metadata, row, ['detail', 'right', 'value']);
        }).toThrow('Property \'BoundaryRow.detail.right\' refused its assigned value.');
        expect(row.detail).toBe(detail);
        expect(row.detail.right).toBeNull();
    });
});

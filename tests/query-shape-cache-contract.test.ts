import { Queryable, type QueryModel, type GroupedQueryable, createQueryModel, createQueryProxy, PredicateExpression } from '../packages/core/src/experimental';
import type { JsonValue } from '../packages/core/src';
import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';
import { SelectSqlBuilder, buildSelectSqlCacheKey } from '../packages/core/src/sql/select-sql-builder';
import type { Order } from './aggregate-query-model/support';
import { createOrderMetadata, RecordingExecutor } from './aggregate-query-model/support';

const metadata = createOrderMetadata();
function orders(): Queryable<Order> {
    return new Queryable(metadata, new RecordingExecutor());
}
function key(query: QueryModel<Order>): string {
    return buildSelectSqlCacheKey(metadata, query);
}
function assertRowTransition(left: QueryModel<Order>, right: QueryModel<Order>): void {
    expect(key(right)).not.toBe(key(left));
    const warm = new SelectSqlBuilder();
    warm.build(metadata, left);
    expect(warm.build(metadata, right)).toEqual(new SelectSqlBuilder().build(metadata, right));
}

describe('row query shape and compiled SQL reuse', () => {
    it.each([
        { label: 'null inequality and scalar inequality', left: () => orders().where(row => row.paidAt.ne(null)), right: () => orders().where(row => row.paidAt.ne(new Date('2026-01-01'))) },
        { label: 'null and non-null checks', left: () => orders().where(row => row.paidAt.isNull()), right: () => orders().where(row => row.paidAt.isNotNull()) },
        { label: 'negated and direct predicates', left: () => orders().where(row => row.totalCents.gt(100)), right: () => orders().where(row => row.totalCents.gt(100).not()) },
        { label: 'negated operands', left: () => orders().where(row => row.totalCents.gt(100).not()), right: () => orders().where(row => row.customerEmail.eq('ada').not()) },
        { label: 'and and or predicates', left: () => orders().where(row => row.totalCents.gt(100).and(row.customerEmail.eq('ada'))), right: () => orders().where(row => row.totalCents.gt(100).or(row.customerEmail.eq('ada'))) },
        { label: 'logical operands', left: () => orders().where(row => row.totalCents.gt(100).and(row.customerEmail.eq('ada'))), right: () => orders().where(row => row.totalCents.gt(100).and(row.workspaceId.eq('ada'))) },
        { label: 'empty and populated membership', left: () => orders().where(row => row.customerEmail.in([])), right: () => orders().where(row => row.customerEmail.in(['ada'])) },
        { label: 'null-only and scalar membership', left: () => orders().where(row => row.paidAt.in([null])), right: () => orders().where(row => row.paidAt.in([new Date('2026-01-01')])) },
    ])('separates $label', ({ left, right }) => {
        assertRowTransition(left().toQueryModel(), right().toQueryModel());
    });
});

describe('projection shape and compiled SQL reuse', () => {
    it.each([
        { label: 'selected fields', left: () => orders().select(row => ({ value: row.customerEmail })), right: () => orders().select(row => ({ value: row.workspaceId })) },
        { label: 'output aliases', left: () => orders().select(row => ({ buyer: row.customerEmail })), right: () => orders().select(row => ({ customer: row.customerEmail })) },
        { label: 'field and literal terms', left: () => orders().select(row => ({ value: row.customerEmail })), right: () => orders().select((_, sql) => ({ value: sql.literal('buyer') })) },
        { label: 'literal and function terms', left: () => orders().select((_, sql) => ({ value: sql.literal('buyer') })), right: () => orders().select((row, sql) => ({ value: sql.lower(row.customerEmail) })) },
        { label: 'function names', left: () => orders().select((row, sql) => ({ value: sql.lower(row.customerEmail) })), right: () => orders().select((row, sql) => ({ value: sql.upper(row.customerEmail) })) },
        { label: 'function operands', left: () => orders().select((row, sql) => ({ value: sql.lower(row.customerEmail) })), right: () => orders().select((row, sql) => ({ value: sql.lower(row.workspaceId) })) },
        { label: 'arithmetic operators', left: () => orders().select((row, sql) => ({ value: sql.add(row.totalCents, sql.literal(10)) })), right: () => orders().select((row, sql) => ({ value: sql.subtract(row.totalCents, sql.literal(10)) })) },
        { label: 'nested output paths', left: () => orders().select(row => ({ buyer: { value: row.customerEmail } })), right: () => orders().select(row => ({ customer: { value: row.customerEmail } })) },
    ])('separates $label', ({ left, right }) => {
        assertRowTransition(left().toQueryModel(), right().toQueryModel());
    });
});

describe('grouped query shape keys', () => {
    const grouped = (): GroupedQueryable<Order, { customer: string; workspace: string }> => orders().groupBy(row => ({ customer: row.customerEmail, workspace: row.workspaceId }));
    it.each([
        { label: 'null checks', left: () => grouped().having(group => group.key.customer.isNull()), right: () => grouped().having(group => group.key.customer.isNotNull()) },
        { label: 'logical operators', left: () => grouped().having(group => group.count().gt(1).and(group.key.customer.eq('ada'))), right: () => grouped().having(group => group.count().gt(1).or(group.key.customer.eq('ada'))) },
        { label: 'negation', left: () => grouped().having(group => group.count().gt(1)), right: () => grouped().having(group => group.count().gt(1).not()) },
        { label: 'negated operands', left: () => grouped().having(group => group.count().gt(1).not()), right: () => grouped().having(group => group.key.customer.eq('ada').not()) },
        { label: 'having operands', left: () => grouped().having(group => group.key.customer.eq('ada')), right: () => grouped().having(group => group.key.workspace.eq('ada')) },
    ])('separates $label when generated SQL changes', ({ left, right }) => {
        const first = left().select(group => ({ customer: group.key.customer, count: group.count() })).toQueryModel();
        const second = right().select(group => ({ customer: group.key.customer, count: group.count() })).toQueryModel();
        expect(key(first)).not.toBe(key(second));
        const builder = new SelectSqlBuilder();
        expect(builder.buildAggregate(metadata, first).text).not.toBe(builder.buildAggregate(metadata, second).text);
    });
});

describe('complete query shape boundaries', () => {
    it.each(['predicate', 'having'])('refuses unsupported %s nodes instead of assigning a cache key', field => {
        const invalid = { ...orders().toQueryModel(), [field]: { node: { kind: 'future' } } };
        expect(() => {
            Reflect.apply(buildSelectSqlCacheKey, undefined, [metadata, invalid]);
        })
            .toThrow('Unsupported query shape: {"kind":"future"}');
    });
    it('distinguishes field comparison operators in joined query keys', () => {
        const first = orders().join('other', { metadata }, ({ root, other }) => root.id.eq(other.id)).select(({ root }) => ({ id: root.id })).toQueryModel();
        const second = orders().join('other', { metadata }, ({ root, other }) => root.id.ne(other.id)).select(({ root }) => ({ id: root.id })).toQueryModel();
        expect(key(first)).not.toBe(key(second));
        expect(new SelectSqlBuilder().build(metadata, first).text).not.toBe(new SelectSqlBuilder().build(metadata, second).text);
    });
    it('distinguishes field comparison operands with the same operator', () => {
        const first = orders().join('other', { metadata }, ({ root, other }) => root.id.eq(other.id)).select(({ root }) => ({ id: root.id })).toQueryModel();
        const second = orders().join('other', { metadata }, ({ root, other }) => root.workspaceId.eq(other.workspaceId)).select(({ root }) => ({ id: root.id })).toQueryModel();
        expect(key(first)).not.toBe(key(second));
        expect(new SelectSqlBuilder().build(metadata, first).text).not.toBe(new SelectSqlBuilder().build(metadata, second).text);
    });
});

describe('literal shape classification and value rebinding', () => {
    it.each([
        { label: 'null and text', left: () => orders().select((_, sql) => ({ value: sql.literal(null) })), right: () => orders().select((_, sql) => ({ value: sql.literal('text') })) },
        { label: 'number and text', left: () => orders().select((_, sql) => ({ value: sql.literal(42) })), right: () => orders().select((_, sql) => ({ value: sql.literal('42') })) },
        { label: 'null and boolean', left: () => orders().select((_, sql) => ({ value: sql.literal(null) })), right: () => orders().select((_, sql) => ({ value: sql.literal(true) })) },
        { label: 'nested null and text', left: () => orders().select((_, sql) => ({ value: sql.coalesce<string | null>(sql.literal(null), sql.literal<string>('fallback')) })), right: () => orders().select((_, sql) => ({ value: sql.coalesce<string | null>(sql.literal<string>('text'), sql.literal<string>('fallback')) })) },
        { label: 'nested text and null', left: () => orders().select((_, sql) => ({ value: sql.concat(sql.literal('number='), sql.literal('42')) })), right: () => orders().select((_, sql) => ({ value: sql.concat(sql.literal('date='), sql.literal(null)) })) },
    ])('keeps $label literal classifications distinct', ({ left, right }) => {
        assertRowTransition(left().toQueryModel(), right().toQueryModel());
    });
    it('reuses comparison SQL when a legacy model binds null outside equality operators', () => {
        const first = { ...orders().toQueryModel(), predicate: new PredicateExpression({ kind: 'binary', operator: 'gt', propertyName: 'paidAt', value: null }) };
        const second = orders().where(row => row.paidAt.gt(new Date('2026-01-01'))).toQueryModel();
        expect(key(first)).toBe(key(second));
        const warm = new SelectSqlBuilder(); warm.build(metadata, first);
        expect(warm.build(metadata, second)).toEqual(new SelectSqlBuilder().build(metadata, second));
    });
});

describe('mapped JSON equality cache reuse', () => {
    class Document {
        public id = ''; public data: JsonValue = null;
    }
    const documentMetadata = new ModelBuilderImplementation().entity(Document, entity => {
        entity.toTable('cache_documents').hasKey('id');
        entity.property('id').hasColumnType('text');
        entity.property('data').hasColumnType('jsonb');
    }).build().getEntity(Document);
    const document = createQueryProxy<Document>();
    it.each([
        { label: 'different array lengths', first: [1], second: [1, 2, 3] },
        { label: 'array and object values', first: [1], second: { edition: 'Paperback' } },
    ])('reuses one equality parameter for $label', ({ first, second }) => {
        const left = { ...createQueryModel(Document), predicate: document.data.eq(first) };
        const right = { ...createQueryModel(Document), predicate: document.data.eq(second) };
        expect(buildSelectSqlCacheKey(documentMetadata, left)).toBe(buildSelectSqlCacheKey(documentMetadata, right));
        const warm = new SelectSqlBuilder(); warm.build(documentMetadata, left);
        const statement = warm.build(documentMetadata, right);
        expect(statement).toEqual(new SelectSqlBuilder().build(documentMetadata, right));
        expect(statement.values).toEqual([JSON.stringify(second)]);
    });
});

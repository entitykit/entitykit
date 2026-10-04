import { Queryable, createQueryModel, type QueryModel } from '../packages/core/src/experimental';
import { Order, createOrderMetadata, RecordingExecutor } from './aggregate-query-model/support';

const metadata = createOrderMetadata();
function orders(model?: QueryModel<Order>): Queryable<Order> {
    return new Queryable(metadata, new RecordingExecutor(), model);
}
const emptyPlan = {
    schemaVersion: 1, entityName: 'Order', tracking: 'track', hasPredicate: false,
    orderings: 0, includes: [], joins: [], relationPredicates: 0,
    projectionFields: 0, groupKeys: 0, aggregateFields: 0, hasHaving: false,
    offset: null, limit: null, ignoresQueryFilters: false, ignoresTenantScope: false,
};

describe('versioned query plan contracts', () => {
    it('keeps zero paging and reports projection, tracking and scope overrides', () => {
        const query = orders().asNoTracking().ignoreQueryFilters().ignoreTenantScope()
            .where(row => row.customerEmail.eq('private-buyer@example.test'))
            .skip(0).take(0).select(row => ({ id: row.id, price: row.totalCents }));
        expect(query.toPlan()).toEqual({
            ...emptyPlan, tracking: 'noTracking', hasPredicate: true,
            projectionFields: 2, offset: 0, limit: 0,
            ignoresQueryFilters: true, ignoresTenantScope: true,
        });
        expect(JSON.stringify(query.toPlan())).not.toContain('private-buyer@example.test');
        expect(orders().toPlan()).toEqual(emptyPlan);
    });
    it('reports grouped keys, aggregate fields and having without leaking values', () => {
        const query = orders().groupBy(row => ({ buyer: row.customerEmail, workspace: row.workspaceId }))
            .having(group => group.count().gt(987654))
            .skip(0).take(4).select(group => ({ buyer: group.key.buyer, count: group.count(), total: group.sum(row => row.totalCents) }));
        expect(query.toPlan()).toEqual({ ...emptyPlan, groupKeys: 2, aggregateFields: 2, hasHaving: true, offset: 0, limit: 4 });
        expect(JSON.stringify(query.toPlan())).not.toContain('987654');
    });
    it('reports join aliases, kinds and entity identities in declared order', () => {
        const query = orders().join('comparison', { metadata }, ({ root, comparison }) => root.id.eq(comparison.id))
            .leftJoin('optional', { metadata }, ({ root, optional }) => root.id.eq(optional.id));
        expect(query.toPlan()).toEqual({ ...emptyPlan, joins: [
            { alias: 'comparison', kind: 'inner', entityName: 'Order' },
            { alias: 'optional', kind: 'left', entityName: 'Order' },
        ] });
    });
    it('reports default query shape without running or exposing parameter values', () => {
        const executor = new RecordingExecutor();
        const query = new Queryable(metadata, executor);
        const plan = query.toPlan();
        expect(plan).toEqual(emptyPlan);
        expect(JSON.parse(JSON.stringify(plan)) as unknown).toEqual(emptyPlan);
        expect(executor.models).toEqual([]);
    });
    it('preserves defaults for legacy models with optional flags omitted', () => {
        const model = { ...createQueryModel(Order), trackingBehavior: undefined, ignoreQueryFilters: undefined, ignoreTenantScope: undefined };
        expect(orders(model).toPlan()).toEqual(emptyPlan);
    });
});

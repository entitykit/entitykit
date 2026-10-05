import { DbContext, valueConverter, type DbContextOptionsBuilder, type ModelBuilder } from '../packages/core/src';
import { Materializer } from '../packages/core/src/experimental';
import { QueryIdentityResolution, useQueryIdentityResolution } from '../packages/core/src/materialization/query-identity-resolution';
import { materializedPersistenceFacts } from '../packages/core/src/materialization/materialized-bound-values';
import { ModelBuilder as InternalModelBuilder } from '../packages/core/src/model/model-builder';
import type { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import { ChangeTracker } from '../packages/core/src/tracking/change-tracker';
import { sqliteProviderServices, sqliteValueReader } from '../packages/sqlite/src';
import { openCompositeIncludeGraph } from './support/include-batching-context';

class IdentityRow {
    public id = { value: '' };
    public tenant = { region: '' };
    public label = '';
}

class FailureRoot {
    public id = 0; public children: FailureChild[] = [];
}
class FailureChild {
    public id = 0; public rootId = 0; public root: FailureRoot | null = null;
}
class FailureContext extends DbContext {
    public roots = this.set(FailureRoot);
    public createdRoots: FailureRoot[] = [];
    public createdChildren: FailureChild[] = [];
    public refuse = true;
    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }
    protected override model(model: ModelBuilder): void {
        model.entity(FailureRoot, entity => {
            entity.toTable('scope_roots'); entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            entity.materialize(values => {
                const row = new FailureRoot();
                this.createdRoots.push(row);
                if (values.id === 2 && this.refuse) {
                    let stored: FailureChild[] = [];
                    Object.defineProperty(row, 'children', {
                        get: () => stored,
                        set: (value: FailureChild[]) => {
                            if (value.length === 0) stored = value;
                        },
                    });
                }
                return row;
            });
        });
        model.entity(FailureChild, entity => {
            entity.toTable('scope_children'); entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            entity.property(row => row.rootId).hasColumnType('integer').isRequired();
            entity.hasOne(FailureRoot, row => row.root).withMany(row => row.children)
                .hasForeignKey(row => row.rootId);
            entity.materialize(() => {
                const child = new FailureChild(); this.createdChildren.push(child); return child;
            });
        });
    }
}

function identityMetadata(): EntityMetadata<IdentityRow> {
    return new InternalModelBuilder().entity(IdentityRow, entity => {
        entity.toTable('identity_scope_rows');
        entity.hasKey(row => row.id);
        entity.tenantKey(row => row.tenant);
        entity.property(row => row.id).hasColumnType('text').isRequired()
            .hasConversion(valueConverter<{ value: string }, string>({
                toProvider: value => value.value,
                fromProvider: value => ({ value }),
            }));
        entity.property(row => row.tenant).hasColumnType('json').isRequired();
        entity.property(row => row.label).hasColumnType('text').isRequired();
    }).build().getEntity(IdentityRow);
}

describe('buffered no-tracking identity scope', () => {
    afterEach(() => jest.restoreAllMocks());

    it('shares roots, nested references, and many-to-many entities across composite chunks without tracking', async () => {
        const db = await openCompositeIncludeGraph(500, 32);
        try {
            const tracking = jest.spyOn(ChangeTracker.prototype, 'track');
            const parents = await db.compositeParents.asNoTracking()
                .include(row => row.children).thenInclude(row => row.parent)
                .include(row => row.labels).thenInclude(row => row.parents)
                .toArray();
            expect(parents).toHaveLength(500);
            for (const parent of parents) {
                expect(parent.children).toHaveLength(1);
                expect(parent.children[0].parent).toBe(parent);
                expect(parent.labels).toHaveLength(2);
                expect(parent.labels[0]).toBe(parents[0].labels[0]);
                expect(parent.labels[1]).toBe(parents[0].labels[1]);
            }
            expect(new Set(parents[0].labels[0].parents)).toEqual(new Set(parents));
            expect(tracking).not.toHaveBeenCalled();
            expect(db.changeTracker.entries()).toEqual([]);
            const second = await db.compositeParents.asNoTracking().toArray();
            expect(second[0]).not.toBe(parents[0]);
        } finally {
            await db.dispose();
        }
    });

    it('resolves converted keys and normalized JSON tenants, keeping captured persistence facts', () => {
        const metadata = identityMetadata();
        const identities = new QueryIdentityResolution();
        const materializer = useQueryIdentityResolution(new Materializer(sqliteValueReader), identities);
        const tracker = new ChangeTracker();
        const first = materializer.materializeWithValues(metadata, {
            id: 'same', tenant: '{"region":"north"}', label: 'first',
        }, tracker);
        const repeated = materializer.materializeWithValues(metadata, {
            id: 'same', tenant: '{"region":"north"}', label: 'later',
        }, tracker);
        const otherTenant = materializer.materializeWithValues(metadata, {
            id: 'same', tenant: '{"region":"south"}', label: 'other',
        }, tracker);
        expect(repeated.entity).toBe(first.entity);
        expect(repeated.values.label).toBe('later');
        expect(repeated.entity.label).toBe('first');
        expect(otherTenant.entity).not.toBe(first.entity);
        first.entity.id.value = 'local change';
        first.entity.tenant.region = 'local change';
        const facts = materializedPersistenceFacts(first.entity);
        expect(facts?.boundValues).toEqual({ id: 'same', tenant: '{"region":"north"}', label: 'first' });
        expect(facts?.values.id).toEqual({ value: 'same' });
        expect(tracker.entries()).toEqual([]);
        identities.clear();
        expect(identities.get(metadata, first.boundValues)).toBeUndefined();
    });

    it('rejects a second object for the same identity without replacing the first', () => {
        const metadata = identityMetadata();
        const identities = new QueryIdentityResolution();
        const bound = { id: 'same', tenant: '{"region":"north"}' };
        const first = new IdentityRow();
        identities.add(metadata, bound, first);
        identities.add(metadata, bound, first);
        expect(() => {
            identities.add(metadata, bound, new IdentityRow());
        })
            .toThrow('Query identity collision for \'IdentityRow\'.');
        expect(identities.get(metadata, bound)).toBe(first);
        const otherMetadata = identityMetadata();
        expect(identities.get(otherMetadata, bound)).toBeUndefined();
        const other = new IdentityRow();
        identities.add(otherMetadata, bound, other);
        expect(identities.get(otherMetadata, bound)).toBe(other);
    });

    it('rolls back a refused graph, releases its scope, and retries without affecting tracked entries', async () => {
        const db = FailureContext.create();
        try {
            await db.database.ensureCreated();
            for (const text of ['insert into scope_roots values (1), (2)',
                'insert into scope_children (id, rootId) values (1, 1), (2, 2)']) {
                await db.database.connection.query({ text, values: [] });
            }
            const sentinel = Object.assign(new FailureRoot(), { id: 3 });
            db.roots.attach(sentinel);
            const clear = jest.spyOn(QueryIdentityResolution.prototype, 'clear');
            const query = async (): ReturnType<typeof db.roots.toArray> => db.roots.asNoTracking()
                .include(row => row.children).orderBy(row => row.id).toArray();
            await expect(query()).rejects.toThrow('refused its assigned value');
            expect(clear).toHaveBeenCalledTimes(1);
            expect(db.createdRoots.map(root => root.children)).toEqual([[], []]);
            expect(db.createdChildren.map(child => child.root)).toEqual([null, null]);
            expect(db.changeTracker.entries().map(entry => entry.entity)).toEqual([sentinel]);
            const failedRoots = [...db.createdRoots];
            db.refuse = false;
            const roots = await query();
            expect(clear).toHaveBeenCalledTimes(2);
            for (const root of roots) {
                expect(failedRoots).not.toContain(root);
                expect(root.children).toHaveLength(1);
                expect(root.children[0].root).toBe(root);
            }
            expect(db.changeTracker.entries().map(entry => entry.entity)).toEqual([sentinel]);
        } finally {
            await db.dispose();
        }
    });
});

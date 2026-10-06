import type { ModelBuilder } from '../packages/core/src';
import type { RelationshipMetadata } from '../packages/core/src/model/relationship-metadata';
import type { TrackedRelationshipMetadata } from '../packages/core/src/tracking/tracked-relationship-metadata';
import { Materializer } from '../packages/core/src/materialization/materializer';
import { SelectSqlBuilder } from '../packages/core/src/sql/select-sql-builder';
import { sqliteDialect } from '../packages/sqlite/src';
import type { IncludeLoaderContext, IncludeLoadRoot } from '../packages/core/src/query/include-loader-context';
import { createReferenceInverseBatch } from '../packages/core/src/query/include-reference-inverse-batch';
import { relationshipDetectionInverseBatch } from '../packages/core/src/tracking/relationship-detection-inverse-batch';
import { navigationPropertyHasDynamicBehavior } from '../packages/core/src/tracking/navigation-property-stability';
import { NavigationWriteJournal } from '../packages/core/src/tracking/navigation-write-journal';
import { inertNavigationLoadTrackerJournal } from '../packages/core/src/tracking/navigation-load-tracker-journal';
import { captureNavigation } from '../packages/core/src/tracking/navigation-snapshot';
import type { EntityEntry } from '../packages/core/src/tracking/entity-entry';
import { RefusalDependent, RefusalGraphContext, RefusalPrincipal } from './support/accessor-refusal-support';
import { contextModel, internalChangeTracker, setMetadata } from './support/public-api-internals';
import { requireDefined } from './support/require-defined';

class Audit {
    public id = 'audit';
}
class PreflightContext extends RefusalGraphContext {
    public audits = this.set(Audit);
    protected override model(model: ModelBuilder): void {
        super.model(model);
        model.entity(Audit, entity => {
            entity.toTable('audit'); entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
    }
}
interface Fixture {
    db: PreflightContext; ctx: IncludeLoaderContext; child: RefusalDependent; parent: RefusalPrincipal;
    root: IncludeLoadRoot<RefusalDependent>; principal: IncludeLoadRoot;
    relationship: RelationshipMetadata<RefusalDependent>;
}
function fixture(): Fixture {
    const db = PreflightContext.create();
    const parent = Object.assign(new RefusalPrincipal(), { id: 'p1' });
    const child = Object.assign(new RefusalDependent(), { id: 'c1', principalId: parent.id });
    db.principals.attach(parent); db.dependents.attach(child);
    return {
        db, parent, child, root: { entity: child, values: {}, boundValues: {} },
        principal: { entity: parent, values: {}, boundValues: {} },
        relationship: setMetadata(db.dependents).relationships[0],
        ctx: {
            model: contextModel(db), database: db.database.connection, changeTracker: internalChangeTracker(db.changeTracker),
            dialect: sqliteDialect, materializer: new Materializer(), selectSql: new SelectSqlBuilder(sqliteDialect),
            journal: new NavigationWriteJournal(), trackerJournal: inertNavigationLoadTrackerJournal,
            fixupTrackedGraph: true, preservePendingRelationships: true,
        },
    };
}

describe('relationship batch preflight ownership', () => {
    afterEach(() => jest.restoreAllMocks());

    it.each(['loaded', 'current', 'baseline', 'untracked'])('inspects the %s inverse owner without executing its getter', async location => {
        const f = fixture();
        try {
            const getter = jest.fn(() => []);
            if (location === 'baseline') {
                f.child.principal = f.parent;
                captureNavigation(requireDefined(f.ctx.changeTracker.entry(f.child)) as unknown as EntityEntry<object>, 'principal');
                f.child.principal = null;
            } else if (location !== 'loaded') f.child.principal = f.parent;
            if (location === 'untracked') f.db.dependents.detach(f.child);
            Object.defineProperty(f.parent, 'dependents', { get: getter });
            const other = { entity: new RefusalPrincipal(), values: {}, boundValues: {} };
            const principals = location === 'loaded' ? [f.principal, other] : [];
            expect(createReferenceInverseBatch(f.ctx, [f.root], f.relationship, principals)).toBeUndefined();
            expect(getter).not.toHaveBeenCalled();
        } finally {
            await f.db.dispose();
        }
    });

    it('refuses reference accessors before reading current or baseline owners', async () => {
        const f = fixture();
        try {
            const getter = jest.fn(() => f.parent);
            Object.defineProperty(f.child, 'principal', { get: getter });
            expect(createReferenceInverseBatch(f.ctx, [f.root], f.relationship, [f.principal])).toBeUndefined();
            expect(getter).not.toHaveBeenCalled();
        } finally {
            await f.db.dispose();
        }
    });

    it('skips graph inspection for a no-tracking include', async () => {
        const f = fixture();
        try {
            const lookup = jest.spyOn(f.ctx.changeTracker, 'entry');
            expect(createReferenceInverseBatch({ ...f.ctx, fixupTrackedGraph: false }, [f.root], f.relationship, [f.principal])).toBeUndefined();
            expect(lookup).not.toHaveBeenCalled();
        } finally {
            await f.db.dispose();
        }
    });

    it('keeps ordinary tracked includes batchable and ignores navigations without an inverse', async () => {
        const f = fixture();
        try {
            const batch = requireDefined(createReferenceInverseBatch(f.ctx, [f.root], f.relationship, [f.principal]));
            batch.add(f.relationship as unknown as TrackedRelationshipMetadata, f.parent, f.child); batch.publish();
            expect(f.parent.dependents).toEqual([f.child]);
            const getter = jest.fn(() => []);
            Object.defineProperty(f.parent, 'dependents', { get: getter });
            const noInverse = { ...f.relationship, inverseNavigationProperty: undefined };
            expect(createReferenceInverseBatch(f.ctx, [f.root], noInverse, [f.principal])).toBeDefined();
            expect(getter).not.toHaveBeenCalled();
        } finally {
            await f.db.dispose();
        }
    });

    it.each(['principal', 'dependent', 'audit'])('reserves immediate ownership for an Added %s', async role => {
        const f = fixture();
        try {
            if (role === 'audit') f.db.audits.add(new Audit());
            else if (role === 'principal') {
                f.db.principals.detach(f.parent);
                f.db.principals.add(f.parent);
            } else {
                f.db.dependents.detach(f.child);
                f.db.dependents.add(f.child);
            }
            const batch = relationshipDetectionInverseBatch(f.ctx.changeTracker, f.ctx.model, f.ctx.changeTracker.entries());
            if (role === 'audit') {
                requireDefined(batch).add(f.relationship as unknown as TrackedRelationshipMetadata, f.parent, f.child);
                requireDefined(batch).publish();
                expect(f.parent.dependents).toEqual([f.child]);
            } else expect(batch).toBeUndefined();
        } finally {
            await f.db.dispose();
        }
    });

    it('keeps dynamic detection live before any reference or collection write', async () => {
        const f = fixture();
        try {
            const getter = jest.fn(() => []);
            Object.defineProperty(f.parent, 'dependents', { get: getter });
            expect(relationshipDetectionInverseBatch(f.ctx.changeTracker, f.ctx.model, f.ctx.changeTracker.entries())).toBeUndefined();
            expect(getter).not.toHaveBeenCalled();
        } finally {
            await f.db.dispose();
        }
    });

    it.each(['01', '1x', 'x1'])('recognizes non-index collection property %s as application behavior', key => {
        const values: unknown[] = [];
        Object.defineProperty(values, key, { value: 'application metadata' });
        expect(navigationPropertyHasDynamicBehavior({ values }, 'values')).toBe(true);
    });

    it('accepts ordinary multi-digit array indexes without reading values', () => {
        const values: unknown[] = [];
        values[10] = 'ten'; values[100] = 'hundred';
        expect(navigationPropertyHasDynamicBehavior({ values }, 'values')).toBe(false);
    });
});

import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import {
    ContextStateRestorationError,
    DbContext,
    DbUpdateConcurrencyError,
    EntityState,
} from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import { requireDefined } from './support/require-defined';
import { refusalMessage, rejection } from './support/accessor-refusal-support';
import type { FactProfile } from './support/converter-fact-support';
import {
    StrongId,
    interceptProperty,
    storedParentId,
    strongIdConverter,
    trackedFactGraph,
} from './support/converter-fact-support';

/** Throw once from an unrelated mapped getter, but only after `armed()`. */
function throwWhenArmed(
    profile: FactProfile,
    armed: () => boolean,
    failure: Error,
): void {
    let stored = profile.ownerId;
    let thrown = false;
    Object.defineProperty(profile, 'ownerId', {
        configurable: true,
        enumerable: true,
        get: () => {
            if (armed() && !thrown) {
                thrown = true;
                throw failure;
            }
            return stored;
        },
        set: (value: StrongId) => {
            stored = value;
        },
    });
}

class FactDoc {
    public id = '';
    public title = '';
    public owner = new StrongId('');
    public version = 1;
}

class ConcurrencyFactContext extends DbContext {
    public docs = this.set(FactDoc);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(FactDoc, entity => {
            entity.toTable('fact_docs');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.title).hasColumnType('text').isRequired();
            entity.property(row => row.owner).hasColumnType('text')
                .hasConversion(strongIdConverter).isRequired();
            entity.property(row => row.version).hasColumnType('integer')
                .isRequired().isVersion();
        });
    }
}

async function openDocs(): Promise<ConcurrencyFactContext> {
    const db = ConcurrencyFactContext.create();
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: `insert into fact_docs (id, title, owner, version)
            values (?, ?, ?, ?)`,
        values: ['d1', 'original', 'o1', 1],
    });
    return db;
}

describe('rollback journals that restore converted model values', () => {
    it('restores a converted foreign key as a valid instance after a throw', async () => {
        const { db, previous, next, child, profile } = await trackedFactGraph();
        let armed = false;
        interceptProperty<StrongId>(child, 'parentId', value => {
            armed = true;
            return value;
        });
        const primary = new Error('unrelated getter failed');
        throwWhenArmed(profile, () => armed, primary);
        child.parent = next;

        const failure = await rejection(() => {
            db.changeTracker.detectChanges();
        });

        expect(failure).toBe(primary);
        expect(child.parentId).toBeInstanceOf(StrongId);
        expect(child.parentId.value).toBe('p1');
        expect(previous.children).toContain(child);
        expect(next.children.map(row => row.id)).toEqual(['c2']);
        const entry = requireDefined(db.entry(child));
        expect((entry.originalValues.parentId as StrongId).value).toBe('p1');
        expect(entry.state).toBe(EntityState.Unchanged);
        await expect(storedParentId(db, 'c1')).resolves.toBe('p1');
        // The old self-inflicted corruption poisoned the context here.
        await expect(db.children.count()).resolves.toBe(2);
        await db.dispose();
    });

    it('poisons the context when the converted key refuses its restoration', async () => {
        const { db, next, child, profile } = await trackedFactGraph();
        let armed = false;
        interceptProperty<StrongId>(child, 'parentId', value => {
            if (value.value === 'p2') {
                armed = true;
                return value;
            }
            return armed ? new StrongId('p2') : value;
        });
        const primary = new Error('unrelated getter failed');
        throwWhenArmed(profile, () => armed, primary);
        child.parent = next;

        const failure = await rejection(() => {
            db.changeTracker.detectChanges();
        });

        expect(failure).toBe(primary);
        expect(child.parentId.value).toBe('p2');
        const poison = await rejection(async () => db.children.count());
        expect(poison).toBeInstanceOf(ContextStateRestorationError);
        expect(poison).not.toBe(failure);
        expect(refusalMessage((poison as Error).cause)).toBe(
            'Property \'FactChild.parentId\' refused its restoration value.',
        );
        expect(await rejection(async () => db.parents.count())).toBe(poison);
        expect(await rejection(async () => db.saveChanges())).toBe(poison);
        await db.dispose();
    });

    it('restores converted concurrency originals and lets the retry succeed', async () => {
        const db = await openDocs();
        const doc = requireDefined(await db.docs.find('d1'));
        const entry = requireDefined(db.entry(doc));
        doc.title = 'client';
        db.changeTracker.detectChanges();
        await db.database.connection.query({
            text: `update fact_docs set title = ?, owner = ?, version = ?
                where id = ?`,
            values: ['database', 'o2', 2, 'd1'],
        });
        const conflict = await rejection(async () => db.saveChanges());
        expect(conflict).toBeInstanceOf(DbUpdateConcurrencyError);
        const values = requireDefined(await entry.getDatabaseValues());
        let refuse = true;
        interceptProperty<number>(doc, 'version', value =>
            refuse && value === 2 ? 1 : value);

        const failure = await rejection(async () =>
            entry.resolveConcurrency('clientWins', values));

        expect(refusalMessage(failure)).toBe(
            'Property \'FactDoc.version\' refused its assigned value.',
        );
        expect(doc.owner).toBeInstanceOf(StrongId);
        expect(doc.owner.value).toBe('o1');
        expect(entry.originalValues.owner).toBeInstanceOf(StrongId);
        expect((entry.originalValues.owner as StrongId).value).toBe('o1');
        expect(entry.state).toBe(EntityState.Modified);

        refuse = false;
        await entry.resolveConcurrency('clientWins', values);
        await expect(db.saveChanges()).resolves.toBe(1);
        const stored = await db.database.connection.query({
            text: 'select title, owner from fact_docs', values: [],
        });
        expect(stored.rows).toEqual([{ title: 'client', owner: 'o1' }]);
        await db.dispose();
    });
});

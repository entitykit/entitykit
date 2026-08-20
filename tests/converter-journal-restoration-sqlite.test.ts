import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import {
    DbContext,
    DeleteBehavior,
    EntityState,
    valueConverter,
} from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import {
    captureConcurrencyRestoration,
} from '../packages/core/src/tracking/concurrency-restoration-journal';
import {
    contextModel,
    internalChangeTracker,
} from './support/public-api-internals';

/** A value object whose state is unreachable through structural cloning. */
class StrongId {
    readonly #value: string;

    constructor(value: string) {
        this.#value = value;
    }

    public get value(): string {
        return this.#value;
    }
}

const strongId = valueConverter<StrongId, string>({
    toProvider: value => value.value,
    fromProvider: value => new StrongId(value),
});

class JournalParent {
    public id = new StrongId('');
    public children: JournalChild[] = [];
}

class JournalChild {
    public id = '';
    public parentId = new StrongId('');
    public parent: JournalParent | null = null;
}

class JournalContext extends DbContext {
    public parents = this.set(JournalParent);
    public children = this.set(JournalChild);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(JournalParent, entity => {
            entity.toTable('journal_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text')
                .hasConversion(strongId).isRequired();
        });
        model.entity(JournalChild, entity => {
            entity.toTable('journal_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('text').hasConversion(strongId).isRequired();
            entity.hasOne(JournalParent, row => row.parent)
                .withMany(row => row.children)
                .hasForeignKey(row => row.parentId)
                .onDelete(DeleteBehavior.Cascade);
        });
    }
}

interface JournalGraph {
    readonly db: JournalContext;
    readonly previous: JournalParent;
    readonly next: JournalParent;
    readonly child: JournalChild;
}

async function openGraph(): Promise<JournalGraph> {
    const db = JournalContext.create();
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    const previous = Object.assign(new JournalParent(), {
        id: new StrongId('p1'),
    });
    const next = Object.assign(new JournalParent(), {
        id: new StrongId('p2'),
    });
    const child = Object.assign(new JournalChild(), {
        id: 'c1', parentId: new StrongId('p1'), parent: previous,
    });
    previous.children = [child];
    db.parents.attach(previous);
    db.parents.attach(next);
    db.children.attach(child);
    return { db, previous, next, child };
}

describe('rollback journals that retain converted model values', () => {
    it('restores a private-field foreign key after a failed fix-up', async () => {
        const { db, previous, next, child } = await openGraph();
        let parentId = new StrongId('p1');
        let throwNextWrite = true;
        Object.defineProperty(child, 'parentId', {
            configurable: true,
            get: () => parentId,
            set: (value: StrongId) => {
                parentId = value;
                if (throwNextWrite) {
                    throwNextWrite = false;
                    throw new Error('relationship FK setter failed');
                }
            },
        });
        child.parent = next;

        expect(() => {
            db.changeTracker.detectChanges();
        }).toThrow('relationship FK setter failed');

        expect(child.parentId).toBeInstanceOf(StrongId);
        expect(child.parentId.value).toBe('p1');
        expect(previous.children).toEqual([child]);
        expect(db.entry(child)?.state).toBe(EntityState.Unchanged);
        expect(await db.parents.count()).toBe(0);
        await db.dispose();
    });

    it('restores concurrency original values as valid model instances', async () => {
        const { db, child } = await openGraph();
        const restore = captureConcurrencyRestoration(
            internalChangeTracker(db.changeTracker),
            contextModel(db),
        );
        child.parentId = new StrongId('p2');

        restore.rollback();

        expect(child.parentId).toBeInstanceOf(StrongId);
        expect(child.parentId.value).toBe('p1');
        expect(() => {
            db.changeTracker.detectChanges();
        }).not.toThrow();
        expect(db.entry(child)?.state).toBe(EntityState.Unchanged);
        expect(await db.parents.count()).toBe(0);
        await db.dispose();
    });
});

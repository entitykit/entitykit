import type {
    DbContextOptionsBuilder,
    ModelBuilder,
    ValueConverter,
} from '../src';
import { DbContext, EntityState } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

class DetectionParent {
    public id = '';
    public children: DetectionChild[] = [];
}

class DetectionChild {
    public id = '';
    public parentId = '';
    public parent: DetectionParent | null = null;
}

class DetectionBomb {
    public id = '';
    public throwGetter = false;
    private storedValue = 'safe';

    public get value(): string {
        if (this.throwGetter) throw new Error('scalar getter failed');
        return this.storedValue;
    }

    public set value(value: string) {
        this.storedValue = value;
    }
}

class NavigationBomb {
    public id = '';
    public parentId = '';
    public throwNavigation = false;
    private storedParent: DetectionParent | null = null;

    public get parent(): DetectionParent | null {
        if (this.throwNavigation) throw new Error('navigation getter failed');
        return this.storedParent;
    }

    public set parent(value: DetectionParent | null) {
        this.storedParent = value;
    }
}

const converterControl = { throws: false };
const throwingConverter: ValueConverter<string, string> = {
    toProvider(value): string {
        if (converterControl.throws) throw new Error('converter failed');
        return value;
    },
    fromProvider(value): string {
        return value;
    },
};

class DetectionContext extends DbContext {
    public parents = this.set(DetectionParent);
    public children = this.set(DetectionChild);
    public bombs = this.set(DetectionBomb);
    public navigationBombs = this.set(NavigationBomb);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(DetectionParent, entity => {
            entity.toTable('detection_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        model.entity(DetectionChild, entity => {
            entity.toTable('detection_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(DetectionParent, row => row.parent)
                .withMany(row => row.children)
                .hasForeignKey(row => row.parentId);
        });
        model.entity(DetectionBomb, entity => {
            entity.toTable('detection_bombs');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.value).hasColumnType('text').isRequired()
                .hasConversion(throwingConverter);
            entity.ignore(row => row.throwGetter);
        });
        model.entity(NavigationBomb, entity => {
            entity.toTable('navigation_bombs');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('text').isRequired();
            entity.ignore(row => row.throwNavigation);
            entity.hasOne(DetectionParent, row => row.parent)
                .withMany()
                .hasForeignKey(row => row.parentId);
        });
    }
}

interface DetectionGraph {
    readonly db: DetectionContext;
    readonly previous: DetectionParent;
    readonly next: DetectionParent;
    readonly child: DetectionChild;
    readonly bomb: DetectionBomb;
    readonly navigationBomb: NavigationBomb;
}

function graph(): DetectionGraph {
    converterControl.throws = false;
    const db = DetectionContext.create();
    const previous = Object.assign(new DetectionParent(), { id: 'p1' });
    const next = Object.assign(new DetectionParent(), { id: 'p2' });
    const child = Object.assign(new DetectionChild(), {
        id: 'c1', parentId: 'p1', parent: previous,
    });
    const bomb = Object.assign(new DetectionBomb(), { id: 'b1' });
    const navigationBomb = Object.assign(new NavigationBomb(), {
        id: 'n1', parentId: 'p1', parent: previous,
    });
    previous.children = [child];
    db.parents.attach(previous);
    db.parents.attach(next);
    db.children.attach(child);
    db.bombs.attach(bomb);
    db.navigationBombs.attach(navigationBomb);
    child.parent = next;
    return { db, previous, next, child, bomb, navigationBomb };
}

function expectUnapplied(value: DetectionGraph): void {
    expect(value.child.parentId).toBe('p1');
    expect(value.child.parent).toBe(value.next);
    expect(value.previous.children).toEqual([value.child]);
    expect(value.next.children).toEqual([]);
    expect(value.db.entry(value.child)?.state).toBe(EntityState.Unchanged);
    expect(value.db.entry(value.child)?.originalValues.parentId).toBe('p1');
    expect(value.db.entry(value.child)?.loadedNavigations()).toEqual([]);
}

describe('public change detection atomicity', () => {
    it.each(['detectChanges', 'debugView'] as const)(
        'rolls back relationship fix-up when %s reaches a throwing scalar getter',
        async operation => {
            const value = graph();
            value.bomb.throwGetter = true;

            expect(() => {
                value.db.changeTracker[operation]();
            })
                .toThrow('scalar getter failed');
            expectUnapplied(value);
            expect(value.db.entry(value.bomb)?.state)
                .toBe(EntityState.Unchanged);
            await value.db.dispose();
        },
    );

    it('rolls back relationship fix-up when scalar conversion fails', async () => {
        const value = graph();
        converterControl.throws = true;

        expect(() => {
            value.db.changeTracker.detectChanges();
        })
            .toThrow('converter failed');
        expectUnapplied(value);
        expect(value.db.entry(value.bomb)?.state).toBe(EntityState.Unchanged);
        converterControl.throws = false;
        await value.db.dispose();
    });

    it('does not start fix-up when a navigation accessor fails', async () => {
        const value = graph();
        value.navigationBomb.throwNavigation = true;

        expect(() => {
            value.db.changeTracker.detectChanges();
        })
            .toThrow('navigation getter failed');
        expectUnapplied(value);
        expect(value.db.entry(value.navigationBomb)?.state)
            .toBe(EntityState.Unchanged);
        await value.db.dispose();
    });
});

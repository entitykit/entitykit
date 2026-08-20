import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import {
    ContextStateRestorationError,
    DbContext,
    DeleteBehavior,
} from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';

class RestoreParent {
    public id = '';
    public children: RestoreChild[] = [];
}

class RestoreChild {
    public id = 0;
    public parentId = '';
    public parent: RestoreParent | null = null;
}

class RestoreIdentityContext extends DbContext {
    public parents = this.set(RestoreParent);
    public children = this.set(RestoreChild);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(RestoreParent, entity => {
            entity.toTable('restore_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        model.entity(RestoreChild, entity => {
            entity.toTable('restore_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().useSqliteRowId();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(RestoreParent, row => row.parent)
                .withMany(row => row.children)
                .hasForeignKey(row => row.parentId)
                .onDelete(DeleteBehavior.Cascade);
        });
    }
}

function requireParent(child: RestoreChild): RestoreParent {
    if (!child.parent) {
        throw new Error('The child navigation lost its principal.');
    }
    return child.parent;
}

describe('relationship detection restore identity', () => {
    it('rejects a clone substituted for a restored navigation value', async () => {
        const db = RestoreIdentityContext.create();
        const previous = Object.assign(new RestoreParent(), { id: 'p1' });
        const next = Object.assign(new RestoreParent(), { id: 'p2' });
        const child = Object.assign(new RestoreChild(), {
            id: 1, parentId: 'p1',
        });
        let storedParent: RestoreParent | null = previous;
        let cloneNextParent = false;
        Object.defineProperty(child, 'parent', {
            configurable: true,
            get: () => storedParent,
            set: (value: RestoreParent | null) => {
                storedParent = cloneNextParent && value
                    ? Object.assign(new RestoreParent(), value)
                    : value;
            },
        });
        previous.children = [child];
        db.parents.attach(previous);
        db.parents.attach(next);
        db.children.attach(child);
        let parentId = 'p1';
        Object.defineProperty(child, 'parentId', {
            configurable: true,
            get: () => parentId,
            set: (value: string) => {
                parentId = value;
                if (!cloneNextParent) {
                    cloneNextParent = true;
                    throw new Error('relationship FK setter failed');
                }
            },
        });
        child.parent = next;

        expect(() => {
            db.changeTracker.detectChanges();
        }).toThrow('relationship FK setter failed');

        expect(child.parent).not.toBe(next);
        expect(db.changeTracker.entry(requireParent(child))).toBeUndefined();
        let unusable: unknown;
        try {
            await db.parents.count();
        } catch (error) {
            unusable = error;
        }
        expect(unusable).toBeInstanceOf(ContextStateRestorationError);
        expect((unusable as Error).cause).toBeInstanceOf(Error);
        expect(((unusable as Error).cause as Error).message).toBe(
            'Navigation \'RestoreChild.parent\' refused its restoration value.',
        );
        await db.dispose();
    });
});

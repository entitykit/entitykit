import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, EntityState } from '../packages/core/src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class LifecycleParent {
    public id = 0;
    public children: LifecycleChild[] = [];
    public optionalChildren: OptionalLifecycleChild[] = [];
}

class LifecycleChild {
    public id = '';
    public parentId = 0;
    public parent: LifecycleParent | null = null;
}

class OptionalLifecycleChild {
    public id = '';
    public parentId: number | null = null;
    public parent: LifecycleParent | null = null;
}

class LifecycleNode {
    public id = 0;
    public parentId = 0;
    public parent: LifecycleNode | null = null;
    public children: LifecycleNode[] = [];
}

class RelationshipLifecycleContext extends DbContext {
    public parents = this.set(LifecycleParent);
    public children = this.set(LifecycleChild);
    public optionalChildren = this.set(OptionalLifecycleChild);
    public nodes = this.set(LifecycleNode);

    constructor(connection = new RecordingDatabaseConnection()) {
        super();
        this.connection = connection;
    }

    private readonly connection: RecordingDatabaseConnection;

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(LifecycleParent, entity => {
            entity.toTable('lifecycle_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().valueGeneratedOnAdd();
        });
        model.entity(LifecycleChild, entity => {
            entity.toTable('lifecycle_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnType('integer')
                .isRequired();
            entity.hasOne(LifecycleParent, row => row.parent)
                .withMany(row => row.children)
                .hasForeignKey(row => row.parentId);
        });
        model.entity(OptionalLifecycleChild, entity => {
            entity.toTable('optional_lifecycle_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnType('integer')
                .isOptional();
            entity.hasOne(LifecycleParent, row => row.parent)
                .withMany(row => row.optionalChildren)
                .hasForeignKey(row => row.parentId);
        });
        model.entity(LifecycleNode, entity => {
            entity.toTable('lifecycle_nodes');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().valueGeneratedOnAdd();
            entity.property(row => row.parentId).hasColumnType('integer')
                .isRequired();
            entity.hasOne(LifecycleNode, row => row.parent)
                .withMany(row => row.children)
                .hasForeignKey(row => row.parentId);
        });
    }
}

const explicitRequired = 'cannot infer a newly added principal';
const ambiguous = 'has an ambiguous FK-only target';
const detachBlocked = 'Cannot detach or cancel newly added \'LifecycleParent\'';

describe('generated relationship target lifecycle', () => {
    it('does not let an early detection pass settle temporary FK intent', () => {
        const db = RelationshipLifecycleContext.create();
        const first = new LifecycleParent();
        const second = new LifecycleParent();
        const child = Object.assign(new LifecycleChild(), { id: 'child' });
        db.parents.add(first);
        db.children.add(child);

        expect(() => {
            db.changeTracker.detectChanges();
        }).toThrow(explicitRequired);
        db.parents.add(second);
        expect(() => {
            db.changeTracker.detectChanges();
        }).toThrow(ambiguous);

        expect(child.parent).toBeNull();
        expect(first.children).toEqual([]);
        expect(second.children).toEqual([]);
    });

    it.each([false, true])(
        'rejects generated self-reference before mutation (explicit=%s)',
        explicit => {
            const db = RelationshipLifecycleContext.create();
            const node = new LifecycleNode();
            if (explicit) node.parent = node;
            db.nodes.add(node);

            expect(() => {
                db.changeTracker.detectChanges();
            }).toThrow('cannot target the same newly added entity');

            expect(node.parent).toBe(explicit ? node : null);
            expect(node.children).toEqual([]);
        },
    );

    it.each(['remove', 'detach'] as const)(
        'rejects %s while an Added dependent targets temporary identity',
        operation => {
            const db = RelationshipLifecycleContext.create();
            const parent = new LifecycleParent();
            const child = Object.assign(new LifecycleChild(), {
                id: 'child', parent,
            });
            db.parents.add(parent);
            db.children.add(child);

            expect(() => db.parents[operation](parent)).toThrow(detachBlocked);

            expect(db.entry(parent)?.state).toBe(EntityState.Added);
            expect(db.entry(child)?.state).toBe(EntityState.Added);
            expect(child.parent).toBe(parent);
        },
    );

    it('rejects cancellation while an existing dependent targets identity', () => {
        const db = RelationshipLifecycleContext.create();
        const parent = new LifecycleParent();
        const child = Object.assign(new LifecycleChild(), {
            id: 'persisted', parentId: 0, parent,
        });
        db.parents.add(parent);
        db.children.attach(child);

        expect(() => db.parents.remove(parent)).toThrow(detachBlocked);

        expect(db.entry(parent)?.state).toBe(EntityState.Added);
        expect(db.entry(child)?.state).toBe(EntityState.Unchanged);
    });

    it('rejects cancellation for an inverse-only explicit relationship', () => {
        const db = RelationshipLifecycleContext.create();
        const parent = new LifecycleParent();
        const child = Object.assign(new LifecycleChild(), { id: 'child' });
        parent.children = [child];
        db.parents.add(parent);
        db.children.add(child);

        expect(() => db.parents.remove(parent)).toThrow(detachBlocked);

        expect(db.entry(parent)?.state).toBe(EntityState.Added);
        expect(db.entry(child)?.state).toBe(EntityState.Added);
        expect(child.parent).toBeNull();
        expect(parent.children).toEqual([child]);
    });

    it('allows detach after an optional Added relationship is severed', () => {
        const db = RelationshipLifecycleContext.create();
        const parent = new LifecycleParent();
        const child: OptionalLifecycleChild = Object.assign(
            new OptionalLifecycleChild(), { id: 'optional', parent },
        );
        db.parents.add(parent);
        db.optionalChildren.add(child);

        expect(() => db.parents.detach(parent)).toThrow(detachBlocked);
        child.parent = null;
        child.parentId = null;
        db.changeTracker.detectChanges();
        expect(() => db.parents.detach(parent)).not.toThrow();

        expect(db.entry(parent)).toBeUndefined();
        expect(db.entry(child)?.state).toBe(EntityState.Added);
        expect(child.parent).toBeNull();
        expect(child.parentId).toBeNull();
    });
});

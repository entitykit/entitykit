import type {
    DbContextOptionsBuilder,
    ModelBuilder,
    SaveChangesInterceptor,
} from '../src';
import { DbContext, EntityState } from '../src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class TargetParent {
    public id = 0;
    public name = '';
    public children: TargetChild[] = [];
}

class TargetChild {
    public id = '';
    public parentId = 0;
    public parent: TargetParent | null = null;
}

class TargetOwner {
    public id = 0;
    public profile: TargetProfile | null = null;
}

class TargetProfile {
    public id = '';
    public ownerId = 0;
    public owner: TargetOwner | null = null;
}

class RelationshipTargetContext extends DbContext {
    public parents = this.set(TargetParent);
    public children = this.set(TargetChild);
    public owners = this.set(TargetOwner);
    public profiles = this.set(TargetProfile);

    constructor(
        private readonly connection: RecordingDatabaseConnection,
        private readonly interceptors: readonly SaveChangesInterceptor[] = [],
    ) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection);
        for (const interceptor of this.interceptors) {
            options.useSaveInterceptor(interceptor);
        }
    }

    protected override model(model: ModelBuilder): void {
        model.entity(TargetParent, entity => {
            entity.toTable('target_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().valueGeneratedOnAdd();
            entity.property(row => row.name).hasColumnType('text').isRequired();
        });
        model.entity(TargetChild, entity => {
            entity.toTable('target_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnType('integer')
                .isRequired();
            entity.hasOne(TargetParent, row => row.parent)
                .withMany(row => row.children)
                .hasForeignKey(row => row.parentId);
        });
        model.entity(TargetOwner, entity => {
            entity.toTable('target_owners');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().valueGeneratedOnAdd();
        });
        model.entity(TargetProfile, entity => {
            entity.toTable('target_profiles');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.ownerId).hasColumnType('integer')
                .isRequired();
            entity.hasOne(TargetOwner, row => row.owner)
                .withOne(row => row.profile)
                .hasForeignKey(row => row.ownerId);
        });
    }
}

const ambiguity = 'has an ambiguous FK-only target';
const unresolved = 'Cannot assign existing \'TargetChild\' to newly added ' +
    '\'TargetParent\' because the relationship key \'TargetParent.id\' has not ' +
    'been generated yet. Save the principal first, then assign the relationship.';
const explicitRequired = 'cannot infer a newly added principal from an ' +
    'unresolved store-generated FK value';

describe('generated relationship target resolution', () => {
    it.each(['principal-first', 'dependent-first'] as const)(
        'rejects one FK-only temporary target with %s tracking',
        order => {
            const db = RelationshipTargetContext.create(
                new RecordingDatabaseConnection(),
            );
            const parent = Object.assign(new TargetParent(), { name: 'new' });
            const child = Object.assign(new TargetChild(), { id: 'child' });
            if (order === 'principal-first') {
                db.parents.add(parent);
                db.children.add(child);
            } else {
                db.children.add(child);
                db.parents.add(parent);
            }

            expect(() => {
                db.changeTracker.detectChanges();
            })
                .toThrow(explicitRequired);

            expect(child).toMatchObject({ parentId: 0, parent: null });
            expect(parent.children).toEqual([]);
        },
    );

    it.each(['principals-first', 'dependent-first'] as const)(
        'rejects two temporary many-to-one targets with %s tracking',
        async order => {
            const connection = new RecordingDatabaseConnection();
            const db = RelationshipTargetContext.create(connection);
            const first = Object.assign(new TargetParent(), { name: 'first' });
            const second = Object.assign(new TargetParent(), { name: 'second' });
            const child = Object.assign(new TargetChild(), { id: 'child' });
            if (order === 'principals-first') {
                db.parents.add(first);
                db.parents.add(second);
                db.children.add(child);
            } else {
                db.children.add(child);
                db.parents.add(first);
                db.parents.add(second);
            }

            await expect(db.saveChanges()).rejects.toThrow(ambiguity);

            expect(child).toMatchObject({ parentId: 0, parent: null });
            expect(first.children).toEqual([]);
            expect(second.children).toEqual([]);
            expect(connection.statements).toEqual([]);
        },
    );

    it('keeps plan inspection and interceptors behind ambiguity validation', async () => {
        const connection = new RecordingDatabaseConnection();
        let interceptorCalls = 0;
        const db = RelationshipTargetContext.create(connection, [{
            savingChanges: () => {
                interceptorCalls += 1;
            },
        }]);
        const first = Object.assign(new TargetParent(), { name: 'first' });
        const second = Object.assign(new TargetParent(), { name: 'second' });
        const child = Object.assign(new TargetChild(), { id: 'child' });
        db.parents.add(first);
        db.parents.add(second);
        db.children.add(child);

        expect(() => db.getSavePlan()).toThrow(ambiguity);
        expect(() => db.getSavePlan()).toThrow(ambiguity);
        await expect(db.saveChanges()).rejects.toThrow(ambiguity);

        expect(interceptorCalls).toBe(0);
        expect(child).toMatchObject({ parentId: 0, parent: null });
        expect(first.children).toEqual([]);
        expect(second.children).toEqual([]);
        expect(connection.statements).toEqual([]);
    });

    it.each(['stable-first', 'temporary-first'] as const)(
        'rejects stable and temporary FK-only targets with %s tracking',
        order => {
            const db = RelationshipTargetContext.create(
                new RecordingDatabaseConnection(),
            );
            const stable = Object.assign(new TargetParent(), {
                id: 0, name: 'stable',
            });
            const temporary = Object.assign(new TargetParent(), {
                name: 'temporary',
            });
            const child = Object.assign(new TargetChild(), { id: 'child' });
            if (order === 'stable-first') {
                db.parents.attach(stable);
                db.parents.add(temporary);
            } else {
                db.parents.add(temporary);
                db.parents.attach(stable);
            }
            db.children.add(child);

            expect(() => {
                db.changeTracker.detectChanges();
            })
                .toThrow(ambiguity);
            expect(child.parent).toBeNull();
            expect(stable.children).toEqual([]);
            expect(temporary.children).toEqual([]);
        },
    );

    it('lets an explicit navigation disambiguate the same raw placeholder', () => {
        const db = RelationshipTargetContext.create(
            new RecordingDatabaseConnection(),
        );
        const first = Object.assign(new TargetParent(), { name: 'first' });
        const second = Object.assign(new TargetParent(), { name: 'second' });
        const child = Object.assign(new TargetChild(), {
            id: 'child', parent: second,
        });
        db.parents.add(first);
        db.parents.add(second);
        db.children.add(child);

        expect(() => {
            db.changeTracker.detectChanges();
        }).not.toThrow();
        expect(child.parent).toBe(second);
        expect(first.children).toEqual([]);
        expect(second.children).toEqual([child]);
    });

    it('does not infer a new temporary target for an unchanged persisted FK', () => {
        const db = RelationshipTargetContext.create(
            new RecordingDatabaseConnection(),
        );
        const child = Object.assign(new TargetChild(), {
            id: 'persisted', parentId: 0,
        });
        db.children.attach(child);
        db.parents.add(Object.assign(new TargetParent(), { name: 'new' }));

        expect(() => {
            db.changeTracker.detectChanges();
        }).not.toThrow();

        expect(child).toMatchObject({ parentId: 0, parent: null });
        expect(db.entry(child)?.state).toBe(EntityState.Unchanged);
    });

    it('rejects reparenting an existing dependent to an unresolved key', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = RelationshipTargetContext.create(connection);
        const child = Object.assign(new TargetChild(), {
            id: 'persisted', parentId: 2,
        });
        const parent = Object.assign(new TargetParent(), { name: 'new' });
        db.children.attach(child);
        db.parents.add(parent);
        child.parent = parent;

        await expect(db.saveChanges()).rejects.toThrow(unresolved);

        expect(child).toMatchObject({ parentId: 2, parent });
        expect(parent.children).toEqual([]);
        expect(db.entry(child)?.state).toBe(EntityState.Unchanged);
        expect(connection.statements).toEqual([]);
    });

    it('validates an unresolved target already present at attachment', () => {
        const db = RelationshipTargetContext.create(
            new RecordingDatabaseConnection(),
        );
        const parent = Object.assign(new TargetParent(), { name: 'new' });
        const child = Object.assign(new TargetChild(), {
            id: 'persisted', parentId: 0, parent,
        });
        db.parents.add(parent);
        db.children.attach(child);

        expect(() => {
            db.changeTracker.detectChanges();
        }).toThrow(unresolved);

        expect(db.entry(child)?.state).toBe(EntityState.Unchanged);
        expect(child.parent).toBe(parent);
        expect(parent.children).toEqual([]);
    });

    it('rejects an existing scalar FK changed to an unresolved placeholder', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = RelationshipTargetContext.create(connection);
        const child = Object.assign(new TargetChild(), {
            id: 'persisted', parentId: 2,
        });
        const parent = Object.assign(new TargetParent(), { name: 'new' });
        db.children.attach(child);
        db.parents.add(parent);
        child.parentId = 0;

        await expect(db.saveChanges()).rejects.toThrow(unresolved);

        expect(child).toMatchObject({ parentId: 0, parent: null });
        expect(parent.children).toEqual([]);
        expect(db.entry(child)?.state).toBe(EntityState.Modified);
        expect(connection.statements).toEqual([]);
    });

    it.each(['stable-first', 'temporary-first'] as const)(
        'protects a one-to-one occupant from a %s collision',
        async order => {
            const connection = new RecordingDatabaseConnection();
            const db = RelationshipTargetContext.create(connection);
            const stable = new TargetOwner();
            const occupied = Object.assign(new TargetProfile(), {
                id: 'occupied', owner: stable,
            });
            stable.profile = occupied;
            const temporary = new TargetOwner();
            const incoming = Object.assign(new TargetProfile(), {
                id: 'incoming', ownerId: 0,
            });
            if (order === 'stable-first') {
                db.owners.attach(stable);
                db.profiles.attach(occupied);
                db.owners.add(temporary);
            } else {
                db.owners.add(temporary);
                db.owners.attach(stable);
                db.profiles.attach(occupied);
            }
            db.profiles.add(incoming);

            await expect(db.saveChanges()).rejects.toThrow(ambiguity);

            expect(stable.profile).toBe(occupied);
            expect(occupied.owner).toBe(stable);
            expect(db.entry(occupied)?.state).toBe(EntityState.Unchanged);
            expect(temporary.profile).toBeNull();
            expect(incoming.owner).toBeNull();
            expect(connection.statements).toEqual([]);
        },
    );
});

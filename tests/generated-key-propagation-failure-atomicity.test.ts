import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, EntityState } from '../src';
import { postgresDialect } from '../src/providers/postgres';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class PropagationRoot {
    public id = 0;
    public middles: PropagationMiddle[] = [];
}

class PropagationMiddle {
    private storedId = 0;
    public root: PropagationRoot | null = null;
    public leafToMutate?: PropagationLeaf;
    public failGeneratedSetter = false;
    public get id(): number {
        return this.storedId;
    }
    public set id(value: number) {
        this.storedId = value;
        if (value > 0 && this.leafToMutate) {
            this.leafToMutate.middleId = value;
            if (this.failGeneratedSetter) {
                throw new Error('propagated key setter failed');
            }
        }
    }
}

class PropagationLeaf {
    public id = '';
    public middleId = 0;
    public middle: PropagationMiddle | null = null;
}

class PropagationContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public roots = this.set(PropagationRoot);
    public middles = this.set(PropagationMiddle);
    public leaves = this.set(PropagationLeaf);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(PropagationContext.connection, {
            provider: postgresDialect.name, dialect: postgresDialect,
        });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(PropagationRoot, entity => {
            entity.toTable('propagation_roots');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().valueGeneratedOnAdd();
        });
        model.entity(PropagationMiddle, entity => {
            entity.toTable('propagation_middles');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            entity.hasOne(PropagationRoot, row => row.root)
                .withMany(row => row.middles).hasForeignKey(row => row.id);
        });
        model.entity(PropagationLeaf, entity => {
            entity.toTable('propagation_leaves');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.middleId).hasColumnName('middle_id')
                .hasColumnType('integer').isRequired();
            entity.hasOne(PropagationMiddle, row => row.middle)
                .withMany().hasForeignKey(row => row.middleId);
        });
    }
}

describe('generated key propagation failure atomicity', () => {
    it('registers a dependent identity before its shared-key setter runs', async () => {
        const connection = new RecordingDatabaseConnection();
        PropagationContext.connection = connection;
        const db = PropagationContext.create();
        const leaf = Object.assign(new PropagationLeaf(), {
            id: 'existing', middleId: 1,
        });
        db.leaves.attach(leaf);
        const root = new PropagationRoot();
        const middle = Object.assign(new PropagationMiddle(), {
            root, leafToMutate: leaf, failGeneratedSetter: true,
        });
        root.middles.push(middle);
        db.middles.add(middle);
        db.roots.add(root);
        connection.queueResult({ rows: [{ id: 41 }], rowCount: 1 });

        await expect(db.saveChanges()).rejects.toThrow(
            'propagated key setter failed',
        );
        expect(root.id).toBe(0);
        expect(middle.id).toBe(0);
        expect(leaf.middleId).toBe(41);
        expect(db.entry(root)?.state).toBe(EntityState.Added);
        expect(db.entry(middle)?.state).toBe(EntityState.Added);
        expect(() => db.getSavePlan()).toThrow(
            'retains a rolled-back store-generated FK',
        );
        expect(connection.statements).toHaveLength(1);
    });
});

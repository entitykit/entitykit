import type {
    DatabaseOperationOptions,
    DatabaseQueryResult,
    DbContextOptionsBuilder,
    ModelBuilder,
    SqlStatement,
} from '../src';
import { DbContext, EntityState } from '../src';
import { postgresDialect } from '../src/providers/postgres';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class GeneratedItem {
    public id!: number;
    public name!: string;
    public updatedAt!: Date;
}

class GeneratedParent {
    public id!: number;
    public name!: string;
}

class GeneratedChild {
    public id!: string;
    public parentId!: number;
    public parent!: GeneratedParent;
}

class GeneratedRaceContext extends DbContext {
    public items = this.set(GeneratedItem);
    public parents = this.set(GeneratedParent);
    public children = this.set(GeneratedChild);

    constructor(private readonly connection: RecordingDatabaseConnection) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection, {
            provider: postgresDialect.name,
            dialect: postgresDialect,
        });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(GeneratedItem, entity => {
            entity.toTable('generated_items');
            entity.hasKey(item => item.id);
            entity.property(item => item.id).hasColumnType('integer').isRequired()
                .valueGeneratedOnAdd();
            entity.property(item => item.name).hasColumnType('text').isRequired();
            entity.property(item => item.updatedAt).hasColumnType('timestamptz')
                .isRequired().valueGeneratedOnAddOrUpdate();
        });
        model.entity(GeneratedParent, entity => {
            entity.toTable('generated_parents');
            entity.hasKey(parent => parent.id);
            entity.property(parent => parent.id).hasColumnType('integer').isRequired()
                .valueGeneratedOnAdd();
            entity.property(parent => parent.name).hasColumnType('text').isRequired();
        });
        model.entity(GeneratedChild, entity => {
            entity.toTable('generated_children');
            entity.hasKey(child => child.id);
            entity.property(child => child.id).hasColumnType('text').isRequired();
            entity.property(child => child.parentId).hasColumnType('integer').isRequired();
            entity.hasOne(GeneratedParent, child => child.parent)
                .withMany().hasForeignKey(child => child.parentId);
        });
    }
}

class DelayedQueryConnection extends RecordingDatabaseConnection {
    private releaseQuery!: () => void;
    private markStarted!: () => void;
    private queryCount = 0;
    public readonly queryStarted: Promise<void>;
    private readonly released: Promise<void>;

    constructor(private readonly delayedQuery: number) {
        super();
        this.released = new Promise(resolve => {
            this.releaseQuery = resolve;
        });
        this.queryStarted = new Promise(resolve => {
            this.markStarted = resolve;
        });
    }

    public release(): void {
        this.releaseQuery();
    }

    public override async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
        statement: SqlStatement,
        options?: DatabaseOperationOptions,
    ): Promise<DatabaseQueryResult<TRow>> {
        this.queryCount += 1;
        if (this.queryCount === this.delayedQuery) {
            this.markStarted();
            await this.released;
        }
        return super.query<TRow>(statement, options);
    }
}

describe('generated-value snapshot acceptance', () => {
    it('accepts the generated primary key rather than a later live mutation', async () => {
        const connection = new DelayedQueryConnection(2);
        const db = GeneratedRaceContext.create(connection);
        const first = Object.assign(new GeneratedItem(), { name: 'first' });
        const second = Object.assign(new GeneratedItem(), { name: 'second' });
        db.items.add(first);
        db.items.add(second);
        connection.queueResult({ rows: [{ id: 41, updatedAt: new Date() }], rowCount: 1 });
        connection.queueResult({ rows: [{ id: 42, updatedAt: new Date() }], rowCount: 1 });

        const saving = db.saveChanges();
        await connection.queryStarted;
        first.id = 999;
        connection.release();
        await expect(saving).resolves.toBe(2);

        expect(db.entry(first)?.originalValues.id).toBe(41);
        expect(db.entry(first)?.state).toBe(EntityState.Modified);
    });

    it('accepts the generated-on-update value returned by the provider', async () => {
        const connection = new DelayedQueryConnection(2);
        const db = GeneratedRaceContext.create(connection);
        const original = new Date('2026-08-03T10:00:00.000Z');
        const persisted = new Date('2026-08-03T11:00:00.000Z');
        const later = new Date('2026-08-03T12:00:00.000Z');
        const first = Object.assign(new GeneratedItem(), {
            id: 1, name: 'before', updatedAt: original,
        });
        const second = Object.assign(new GeneratedItem(), {
            id: 2, name: 'before', updatedAt: original,
        });
        db.items.attach(first);
        db.items.attach(second);
        first.name = 'after';
        second.name = 'after';
        connection.queueResult({ rows: [{ updatedAt: persisted }], rowCount: 1 });
        connection.queueResult({ rows: [{ updatedAt: later }], rowCount: 1 });

        const saving = db.saveChanges();
        await connection.queryStarted;
        first.updatedAt = later;
        connection.release();
        await saving;

        expect(db.entry(first)?.originalValues.updatedAt).toEqual(persisted);
    });

    it('accepts the propagated foreign key used by dependent SQL', async () => {
        const connection = new DelayedQueryConnection(2);
        const db = GeneratedRaceContext.create(connection);
        const parent = Object.assign(new GeneratedParent(), { name: 'parent' });
        const child = Object.assign(new GeneratedChild(), {
            id: 'child_1', parent,
        });
        db.children.add(child);
        db.parents.add(parent);
        connection.queueResult({ rows: [{ id: 71 }], rowCount: 1 });
        connection.queueResult({ rowCount: 1 });

        const saving = db.saveChanges();
        await connection.queryStarted;
        child.parentId = 999;
        connection.release();
        await saving;

        expect(connection.statements[1]?.values).toEqual(['child_1', 71]);
        expect(db.entry(child)?.originalValues.parentId).toBe(71);
        expect(db.entry(child)?.state).toBe(EntityState.Modified);
    });
});

import type {
    DatabaseConnection,
    DatabaseOperationOptions,
    DatabaseQueryResult,
    DbContextOptionsBuilder,
    ModelBuilder,
    SqlStatement,
    TransactionOptions,
} from '../../packages/core/src';
import { DbContext } from '../../packages/core/src';
import {
    SqliteDatabaseConnection,
    sqliteProviderServices,
} from '../../packages/sqlite/src';
import { requireDefined } from './require-defined';

export class PartOwner {
    public id = '';
    public docs: PartDoc[] = [];
    public notes: PartNote[] = [];
}

export class PartReviewer {
    public id = '';
    public docs: PartDoc[] = [];
}

export class PartDoc {
    public id = '';
    public ownerId = '';
    public reviewerId = '';
    public owner: PartOwner | null = null;
    public reviewer: PartReviewer | null = null;
}

export class PartNote {
    public id = '';
    public ownerId = '';
    public owner: PartOwner | null = null;
}

/** A real SQLite connection that can hold one statement open, then fail it. */
export class PausingSqliteConnection implements DatabaseConnection {
    private readonly inner = new SqliteDatabaseConnection(':memory:');
    private fragment?: string;
    private reached?: () => void;
    private refuse?: (error: Error) => void;

    /** Hold the next statement matching `fragment`; resolves when it arrives. */
    public async pauseOn(fragment: string): Promise<void> {
        this.fragment = fragment;
        return new Promise<void>(resolve => {
            this.reached = resolve;
        });
    }

    /** Release the held statement by failing it, as a dead read would. */
    public failPaused(error: Error): void {
        requireDefined(this.refuse, 'paused statement')(error);
    }

    public get isInTransaction(): boolean {
        return this.inner.isInTransaction;
    }

    public async query<
        TRow extends Record<string, unknown> = Record<string, unknown>,
    >(
        statement: SqlStatement,
        options?: DatabaseOperationOptions,
    ): Promise<DatabaseQueryResult<TRow>> {
        if (
            this.fragment !== undefined &&
            statement.text.includes(this.fragment)
        ) {
            this.fragment = undefined;
            const held: Promise<never> = new Promise((resolve, reject) => {
                this.refuse = reject;
            });
            this.reached?.();
            await held;
        }
        return this.inner.query<TRow>(statement, options);
    }

    public async transaction<TResult>(
        work: () => TResult | Promise<TResult>,
        options?: TransactionOptions,
    ): Promise<TResult> {
        return this.inner.transaction(work, options);
    }

    public async session<TResult>(
        work: () => TResult | Promise<TResult>,
        options?: DatabaseOperationOptions,
    ): Promise<TResult> {
        return this.inner.session(work, options);
    }

    public async dispose(): Promise<void> {
        return this.inner.dispose();
    }
}

/** A doc with two independent references, one of which nests further. */
export class PartParticipationContext extends DbContext {
    public readonly connection = new PausingSqliteConnection();
    public owners = this.set(PartOwner);
    public reviewers = this.set(PartReviewer);
    public docs = this.set(PartDoc);
    public notes = this.set(PartNote);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection, {
            provider: 'sqlite',
            dialect: sqliteProviderServices.dialect,
            migrationDialect: sqliteProviderServices.migrationDialect,
            createMigrationBuilder:
                sqliteProviderServices.createMigrationBuilder,
            valueReader: sqliteProviderServices.valueReader,
        });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(PartOwner, entity => {
            entity.toTable('part_owners');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        model.entity(PartReviewer, entity => {
            entity.toTable('part_reviewers');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        model.entity(PartDoc, entity => {
            entity.toTable('part_docs');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.ownerId).hasColumnName('owner_id')
                .hasColumnType('text').isRequired();
            entity.property(row => row.reviewerId).hasColumnName('reviewer_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(PartOwner, row => row.owner)
                .withMany(row => row.docs)
                .hasForeignKey(row => row.ownerId);
            entity.hasOne(PartReviewer, row => row.reviewer)
                .withMany(row => row.docs)
                .hasForeignKey(row => row.reviewerId);
        });
        model.entity(PartNote, entity => {
            entity.toTable('part_notes');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.ownerId).hasColumnName('owner_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(PartOwner, row => row.owner)
                .withMany(row => row.notes)
                .hasForeignKey(row => row.ownerId);
        });
    }
}

/** One owner with one note, two reviewers, and one doc pointing at both. */
export async function openParticipationGraph():
Promise<PartParticipationContext> {
    const db = PartParticipationContext.create();
    for (const statement of [
        { text: db.database.createScript(), values: [] },
        { text: 'insert into part_owners (id) values (?)', values: ['o1'] },
        {
            text: 'insert into part_reviewers (id) values (?), (?)',
            values: ['r1', 'r2'],
        },
        {
            text: `insert into part_docs (id, owner_id, reviewer_id)
                values (?, ?, ?)`,
            values: ['doc1', 'o1', 'r1'],
        },
        {
            text: 'insert into part_notes (id, owner_id) values (?, ?)',
            values: ['n1', 'o1'],
        },
    ]) await db.database.connection.query(statement);
    return db;
}

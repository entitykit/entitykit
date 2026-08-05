import type {
    DatabaseOperationOptions,
    DatabaseQueryResult,
    DbContextOptionsBuilder,
    ModelBuilder,
    SaveChangesInterceptor,
    SqlStatement,
} from '../src';
import { DbContext, EntityState } from '../src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class VersionedDocument {
    public id!: string;
    public title!: string;
    public version!: number;
}

class VersionBoundaryContext extends DbContext {
    public documents = this.set(VersionedDocument);

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
        model.entity(VersionedDocument, entity => {
            entity.toTable('versioned_documents');
            entity.hasKey(document => document.id);
            entity.property(document => document.id).hasColumnType('text').isRequired();
            entity.property(document => document.title).hasColumnType('text').isRequired();
            entity.property(document => document.version).hasColumnType('integer')
                .isRequired().isVersion();
        });
    }
}

class DelayedConnection extends RecordingDatabaseConnection {
    private releaseQuery?: () => void;
    private markQueryStarted?: () => void;
    private readonly queryGate: Promise<void> = new Promise(resolve => {
        this.releaseQuery = resolve;
    });
    public readonly queryStarted: Promise<void> = new Promise(resolve => {
        this.markQueryStarted = resolve;
    });

    public release(): void {
        this.releaseQuery?.();
    }

    public override async query<
        TRow extends Record<string, unknown> = Record<string, unknown>,
    >(
        statement: SqlStatement,
        options?: DatabaseOperationOptions,
    ): Promise<DatabaseQueryResult<TRow>> {
        this.markQueryStarted?.();
        await this.queryGate;
        return super.query<TRow>(statement, options);
    }
}

function trackedDocument(): VersionedDocument {
    return Object.assign(new VersionedDocument(), {
        id: 'document-1',
        title: 'First',
        version: 1,
    });
}

describe('version ownership at save boundaries', () => {
    it('rejects a version changed by savingChanges before provider work', async () => {
        const connection = new RecordingDatabaseConnection();
        const document = trackedDocument();
        const db = VersionBoundaryContext.create(connection, [{
            savingChanges: () => {
                document.version = 100;
            },
        }]);
        db.documents.attach(document);
        document.title = 'Second';

        await expect(db.saveChanges()).rejects.toThrow(
            'Version property \'VersionedDocument.version\' is managed by EntityKit and cannot be modified directly.',
        );

        expect(connection.statements).toEqual([]);
        expect(document.version).toBe(100);
        expect(db.entry(document)?.state).toBe(EntityState.Modified);
    });

    it('accepts the database version while preserving an in-flight application change', async () => {
        const connection = new DelayedConnection();
        connection.queueResult({ rowCount: 1 });
        const db = VersionBoundaryContext.create(connection);
        const document = trackedDocument();
        db.documents.attach(document);
        document.title = 'Second';

        const saving = db.saveChanges();
        await connection.queryStarted;
        document.version = 100;
        connection.release();

        await expect(saving).resolves.toBe(1);
        expect(db.entry(document)?.originalValues).toMatchObject({
            title: 'Second',
            version: 2,
        });
        expect(document.version).toBe(100);
        expect(db.entry(document)?.state).toBe(EntityState.Modified);
        await expect(db.saveChanges()).rejects.toThrow(
            'Version property \'VersionedDocument.version\' is managed by EntityKit and cannot be modified directly.',
        );
        expect(connection.statements).toHaveLength(1);
    });
});

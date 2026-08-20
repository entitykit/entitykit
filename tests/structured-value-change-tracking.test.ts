import { requireDefined } from './support/require-defined';
import type {
    DbContextOptionsBuilder,
    ModelBuilder } from '../packages/core/src';
import {
    DbContext,
    EntityState,
    valueConverter,
} from '../packages/core/src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

interface DocumentPayload {
    metadata: { title: string };
    tags: string[];
}

class DocumentSettings {
    constructor(public readonly flags: string[]) {}
}

const settingsConverter = valueConverter<DocumentSettings, { flags: string[] }>({
    toProvider: settings => ({ flags: settings.flags }),
    fromProvider: value => new DocumentSettings(value.flags),
});

class Document {
    public id!: string;
    public payload!: DocumentPayload;
    public settings!: DocumentSettings;
}

class DocumentContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public documents = this.set(Document);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(DocumentContext.connection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Document, entity => {
            entity.toTable('documents');
            entity.hasKey(document => document.id);
            entity.property(document => document.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(document => document.payload).hasColumnName('payload').hasColumnType('jsonb').isRequired();
            entity.property(document => document.settings)
                .hasColumnName('settings')
                .hasColumnType('jsonb')
                .hasConversion(settingsConverter)
                .isRequired();
        });
    }
}

describe('structured value change tracking', () => {
    it('persists in-place nested object, array, and converted-value mutations', async () => {
        const connection = new RecordingDatabaseConnection();
        DocumentContext.connection = connection;
        const db =  DocumentContext.create();
        connection.queueResult({
            rows: [{
                id: 'doc_1',
                payload: { metadata: { title: 'Draft' }, tags: ['typescript'] },
                settings: { flags: ['review'] },
            }],
            rowCount: 1,
        });

        const document = await db.documents.find('doc_1');
        expect(document).not.toBeNull();
        expect(db.entry(requireDefined(document))?.state).toBe(EntityState.Unchanged);
        await expect(db.saveChanges()).resolves.toBe(0);

        requireDefined(document).payload.metadata.title = 'Published';
        requireDefined(document).payload.tags.push('orm');
        requireDefined(document).settings.flags.push('approved');
        connection.queueResult({ rowCount: 1 });

        await expect(db.saveChanges()).resolves.toBe(1);

        expect(connection.statements.at(-1)).toEqual({
            text: 'update "documents" set "payload" = $1, "settings" = $2 where "id" = $3',
            values: [
                '{"metadata":{"title":"Published"},"tags":["typescript","orm"]}',
                '{"flags":["review","approved"]}',
                'doc_1',
            ],
        });
        expect(db.entry(requireDefined(document))?.state).toBe(EntityState.Unchanged);
    });
});

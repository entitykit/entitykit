import { GeneratedRelationshipTransactionContext } from './generated-relationship-transaction-model';
import { RecordingDatabaseConnection } from './recording-database-connection';

export function generatedRelationshipContext(): {
    readonly db: GeneratedRelationshipTransactionContext;
    readonly connection: RecordingDatabaseConnection;
} {
    const connection = new RecordingDatabaseConnection();
    return {
        db: GeneratedRelationshipTransactionContext.create(connection),
        connection,
    };
}

export async function establishGeneratedRelationshipProvenance(options: {
    readonly db: GeneratedRelationshipTransactionContext;
    readonly connection: RecordingDatabaseConnection;
    readonly addPrincipal: () => void;
    readonly addDependent: () => void;
    readonly assignGeneratedForeignKey: () => void;
    readonly generatedRow: Readonly<Record<string, unknown>>;
}): Promise<void> {
    await expect(options.db.transaction(async tx => {
        options.addPrincipal();
        options.connection.queueResult({
            rows: [options.generatedRow], rowCount: 1,
        });
        await tx.saveChanges();
        options.assignGeneratedForeignKey();
        options.addDependent();
        options.connection.queueResult({ rowCount: 1 });
        await tx.saveChanges();
        throw new Error('abort provenance setup');
    })).rejects.toThrow('abort provenance setup');
}

export async function retryGeneratedRelationship(
    db: GeneratedRelationshipTransactionContext,
    connection: RecordingDatabaseConnection,
    generatedRow: Readonly<Record<string, unknown>>,
): Promise<void> {
    connection.queueResult({ rows: [generatedRow], rowCount: 1 });
    connection.queueResult({ rowCount: 1 });
    await expect(db.saveChanges()).resolves.toBe(2);
}

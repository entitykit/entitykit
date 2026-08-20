import { EntityState } from '../packages/core/src';
import {
    GeneratedRelationshipTransactionContext,
} from './support/generated-relationship-transaction-model';
import {
    type UnplannedKeyShapeFixture,
    unplannedKeyShapes,
} from './support/generated-relationship-unplanned-key-shapes';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

function context(): {
    readonly db: GeneratedRelationshipTransactionContext;
    readonly connection: RecordingDatabaseConnection;
} {
    const connection = new RecordingDatabaseConnection();
    return {
        db: GeneratedRelationshipTransactionContext.create(connection),
        connection,
    };
}

async function rollbackUnplanned(
    fixture: UnplannedKeyShapeFixture,
    db: GeneratedRelationshipTransactionContext,
    connection: RecordingDatabaseConnection,
    track: 'add' | 'attach',
): Promise<void> {
    if (track === 'attach') fixture.attachDependent();
    await expect(db.transaction(async tx => {
        fixture.addPrincipal();
        connection.queueResult({ rows: [fixture.firstRow], rowCount: 1 });
        await tx.saveChanges();
        fixture.assignGeneratedForeignKey();
        if (track === 'add') fixture.addDependent();
        throw new Error('abort before dependent plan');
    })).rejects.toThrow('abort before dependent plan');
}

describe('unplanned generated relationship key shapes', () => {
    it.each(unplannedKeyShapes)('retargets an added $name', async shape => {
        const { db, connection } = context();
        const fixture = shape.create(db);
        await rollbackUnplanned(fixture, db, connection, 'add');

        expect(db.entry(fixture.dependent)?.state).toBe(EntityState.Added);
        connection.queueResult({ rows: [fixture.secondRow], rowCount: 1 });
        connection.queueResult({ rowCount: 1 });
        await expect(db.saveChanges()).resolves.toBe(2);
        fixture.assertRetargeted();
    });

    it.each(unplannedKeyShapes)('fails closed for an existing $name', async shape => {
        const { db, connection } = context();
        const fixture = shape.create(db);
        await rollbackUnplanned(fixture, db, connection, 'attach');

        const statements = connection.statements.length;
        expect(() => db.getSavePlan()).toThrow('has not been generated yet');
        expect(connection.statements).toHaveLength(statements);
    });
});

import type {
    DbContextOptionsBuilder,
    ModelBuilder,
} from '../src';
import { DbContext } from '../src';
import { postgresDialect } from '../src/providers/postgres';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class GeneratedPrincipal {
    public id!: string;
    public code!: string;
}

class GeneratedDependent {
    public id!: string;
    public principalCode!: string;
    public principal!: GeneratedPrincipal;
}

class GeneratedAlternateKeyContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public principals = this.set(GeneratedPrincipal);
    public dependents = this.set(GeneratedDependent);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(
            GeneratedAlternateKeyContext.connection,
            { provider: postgresDialect.name, dialect: postgresDialect },
        );
    }

    protected override model(model: ModelBuilder): void {
        model.entity(GeneratedPrincipal, entity => {
            entity.toTable('generated_principals');
            entity.hasKey(item => item.id);
            entity.property(item => item.id).hasColumnType('text').isRequired();
            entity.property(item => item.code).hasColumnType('text').isRequired()
                .valueGeneratedOnAdd();
            entity.hasAlternateKey(item => item.code);
        });
        model.entity(GeneratedDependent, entity => {
            entity.toTable('generated_dependents');
            entity.hasKey(item => item.id);
            entity.property(item => item.id).hasColumnType('text').isRequired();
            entity.property(item => item.principalCode).hasColumnType('text').isRequired();
            entity.hasOne(GeneratedPrincipal, item => item.principal)
                .withMany()
                .hasForeignKey(item => item.principalCode)
                .hasPrincipalKey(item => item.code);
        });
    }
}

describe('database-generated alternate keys', () => {
    it('hydrates and propagates a generated principal tuple before dependent SQL', async () => {
        const connection = new RecordingDatabaseConnection();
        GeneratedAlternateKeyContext.connection = connection;
        const db = GeneratedAlternateKeyContext.create();
        const principal = { id: 'principal_1' } as GeneratedPrincipal;
        const dependent = {
            id: 'dependent_1',
            principal,
        } as GeneratedDependent;
        db.dependents.add(dependent);
        db.principals.add(principal);
        connection.queueResult({
            rows: [{ code: 'generated-code' }],
            rowCount: 1,
        });
        connection.queueResult({ rowCount: 1 });

        await expect(db.saveChanges()).resolves.toBe(2);

        expect(principal.code).toBe('generated-code');
        expect(dependent.principalCode).toBe('generated-code');
        expect(connection.statements).toEqual([
            {
                text: 'insert into "generated_principals" ("id") values ($1) returning "code"',
                values: ['principal_1'],
            },
            {
                text: 'insert into "generated_dependents" ("id", "principalCode") values ($1, $2)',
                values: ['dependent_1', 'generated-code'],
            },
        ]);
    });
});

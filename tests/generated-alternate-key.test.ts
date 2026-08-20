import type {
    DbContextOptionsBuilder,
    ModelBuilder,
} from '../packages/core/src';
import { DbContext } from '../packages/core/src';
import { postgresDialect } from '../packages/postgres/src';
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
    it('rejects one generated alternate placeholder without navigation', () => {
        GeneratedAlternateKeyContext.connection =
            new RecordingDatabaseConnection();
        const db = GeneratedAlternateKeyContext.create();
        db.principals.add({ id: 'principal_1', code: '' });
        db.dependents.add({
            id: 'dependent_1', principalCode: '',
        } as GeneratedDependent);

        expect(() => {
            db.changeTracker.detectChanges();
        })
            .toThrow('cannot infer a newly added principal');
    });

    it('rejects multiple stable tracked principals with one relationship key', () => {
        GeneratedAlternateKeyContext.connection =
            new RecordingDatabaseConnection();
        const db = GeneratedAlternateKeyContext.create();
        db.principals.attach({
            id: 'principal_1', code: 'duplicate-code',
        });
        db.principals.attach({
            id: 'principal_2', code: 'duplicate-code',
        });
        db.dependents.add({
            id: 'dependent_1', principalCode: 'duplicate-code',
        } as GeneratedDependent);

        expect(() => {
            db.changeTracker.detectChanges();
        }).toThrow('has an ambiguous FK-only target');
    });

    it('rejects an FK-only placeholder shared by generated alternate keys', () => {
        GeneratedAlternateKeyContext.connection =
            new RecordingDatabaseConnection();
        const db = GeneratedAlternateKeyContext.create();
        db.principals.add({
            id: 'principal_1', code: '',
        });
        db.principals.add({
            id: 'principal_2', code: '',
        });
        db.dependents.add({
            id: 'dependent_1', principalCode: '',
        } as GeneratedDependent);

        expect(() => {
            db.changeTracker.detectChanges();
        }).toThrow('has an ambiguous FK-only target');
    });

    it('rejects an existing dependent assigned to an unresolved alternate key', async () => {
        const connection = new RecordingDatabaseConnection();
        GeneratedAlternateKeyContext.connection = connection;
        const db = GeneratedAlternateKeyContext.create();
        const dependent = {
            id: 'dependent_1', principalCode: 'persisted-code',
        } as GeneratedDependent;
        const principal = { id: 'principal_1' } as GeneratedPrincipal;
        db.dependents.attach(dependent);
        db.principals.add(principal);
        dependent.principal = principal;

        await expect(db.saveChanges()).rejects.toThrow(
            'relationship key \'GeneratedPrincipal.code\' has not been generated',
        );

        expect(dependent.principalCode).toBe('persisted-code');
        expect(connection.statements).toEqual([]);
    });

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

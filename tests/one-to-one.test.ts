import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import type { DatabaseSchemaSnapshot } from '../packages/core/src/tooling';
import { DbContext, RelationshipCardinality } from '../packages/core/src';
import { generateDbPullCode } from '../packages/core/src/tooling';
import { SchemaSqlBuilder } from '../packages/core/src/schema/schema-sql-builder';
import { RecordingDatabaseConnection } from './support/recording-database-connection';
import { requireDefined } from './support/require-defined';
import { contextModel, setMetadata } from './support/public-api-internals';

class Account {
    public id!: string;
    public email!: string;
    public profile!: AccountProfile | null;
}

class AccountProfile {
    public id!: string;
    public accountId!: string;
    public bio!: string;
    public account!: Account;
}

class OneToOneContext extends DbContext {
    public static connection: RecordingDatabaseConnection;

    public accounts = this.set(Account);
    public profiles = this.set(AccountProfile);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(OneToOneContext.connection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Account, entity => {
            entity.toTable('accounts');
            entity.hasKey(account => account.id);
            entity.property(account => account.id)
                .hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(account => account.email)
                .hasColumnName('email').hasColumnType('text').isRequired();
        });
        model.entity(AccountProfile, entity => {
            entity.toTable('account_profiles');
            entity.hasKey(profile => profile.id);
            entity.property(profile => profile.id)
                .hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(profile => profile.accountId)
                .hasColumnName('account_id').hasColumnType('text').isRequired();
            entity.property(profile => profile.bio)
                .hasColumnName('bio').hasColumnType('text').isRequired();
            entity.hasOne(Account, profile => profile.account)
                .withOne(account => account.profile)
                .hasForeignKey(profile => profile.accountId);
        });
    }
}

function createDb(connection = new RecordingDatabaseConnection()): OneToOneContext {
    OneToOneContext.connection = connection;
    return OneToOneContext.create();
}

describe('one-to-one relationships', () => {
    it('records cardinality and infers a unique foreign-key index', () => {
        const db = createDb();
        const metadata = setMetadata(db.profiles);

        expect(metadata.relationships[0]?.cardinality)
            .toBe(RelationshipCardinality.OneToOne);
        expect(metadata.indexes).toContainEqual({
            propertyNames: ['accountId'],
            isUnique: true,
        });
        expect(new SchemaSqlBuilder().build(contextModel(db))).toContain(
            'unique index if not exists "ux_account_profiles_account_id"',
        );
        expect(contextModel(db).toSnapshot().entities
            .find(entity => entity.entityName === 'AccountProfile')
            ?.relationships[0]?.cardinality).toBe('oneToOne');
    });

    it('loads an inverse one-to-one as a scalar and fixes up both sides', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({
            rows: [
                { id: 'a1', email: 'one@example.com' },
                { id: 'a2', email: 'two@example.com' },
            ],
            rowCount: 2,
        });
        connection.queueResult({
            rows: [{ id: 'p1', account_id: 'a1', bio: 'hello' }],
            rowCount: 1,
        });
        const db = createDb(connection);

        const accounts = await db.accounts
            .include(account => account.profile)
            .orderBy(account => account.id)
            .toArray();

        expect(accounts[0]?.profile).toBeInstanceOf(AccountProfile);
        expect(accounts[0]?.profile?.account).toBe(accounts[0]);
        expect(accounts[1]?.profile).toBeNull();
        expect(db.entry(requireDefined(accounts[0]))?.loadedNavigations())
            .toContain('profile');
    });

    it('fixes the inverse reference when loading from the dependent side', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({
            rows: [{ id: 'p1', account_id: 'a1', bio: 'hello' }],
            rowCount: 1,
        });
        connection.queueResult({
            rows: [{ id: 'a1', email: 'one@example.com' }],
            rowCount: 1,
        });
        const db = createDb(connection);

        const profile = await db.profiles
            .include(item => item.account)
            .single();

        expect(profile.account.profile).toBe(profile);
        expect(db.entry(profile.account)?.loadedNavigations())
            .toContain('profile');
    });

    it('synchronizes both references when a tracked dependent is reassigned', () => {
        const db = createDb();
        const previous = {
            id: 'a1',
            email: 'old@example.com',
        } as Account;
        const next = {
            id: 'a2',
            email: 'next@example.com',
            profile: null,
        } as Account;
        const profile = {
            id: 'p1',
            accountId: previous.id,
            bio: 'hello',
            account: previous,
        };
        previous.profile = profile;
        db.accounts.attach(previous);
        db.accounts.attach(next);
        db.profiles.attach(profile);

        profile.account = next;
        db.changeTracker.detectChanges();

        expect(profile.accountId).toBe('a2');
        expect(previous.profile).toBeNull();
        expect(next.profile).toBe(profile);
        expect(db.entry(profile)?.state).toBe('Modified');
    });

    it('loads inverse one-to-one references explicitly', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({
            rows: [{ id: 'p1', account_id: 'a1', bio: 'hello' }],
            rowCount: 1,
        });
        const db = createDb(connection);
        const account = { id: 'a1', email: 'one@example.com' } as Account;
        db.accounts.attach(account);

        const profile = await requireDefined(db.entry(account))
            .reference(item => item.profile)
            .load();

        expect(profile?.account).toBe(account);
        expect(account.profile).toBe(profile);
    });

    it('rejects duplicate dependent rows instead of hiding bad cardinality', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({
            rows: [{ id: 'a1', email: 'one@example.com' }],
            rowCount: 1,
        });
        connection.queueResult({
            rows: [
                { id: 'p1', account_id: 'a1', bio: 'first' },
                { id: 'p2', account_id: 'a1', bio: 'second' },
            ],
            rowCount: 2,
        });
        const db = createDb(connection);

        await expect(db.accounts.include(account => account.profile).single())
            .rejects.toThrow('matched 2 dependent rows');
    });

    it('recognizes unique foreign keys during db pull', () => {
        const snapshot: DatabaseSchemaSnapshot = {
            schemas: [{
                name: '',
                tables: [
                    {
                        schemaName: '',
                        tableName: 'accounts',
                        columns: [{
                            name: 'id',
                            ordinal: 1,
                            storeType: 'text',
                            isNullable: false,
                        }],
                        primaryKey: { name: 'pk_accounts', columns: ['id'] },
                        indexes: [],
                        foreignKeys: [],
                    },
                    {
                        schemaName: '',
                        tableName: 'account_profiles',
                        columns: [
                            {
                                name: 'id',
                                ordinal: 1,
                                storeType: 'text',
                                isNullable: false,
                            },
                            {
                                name: 'account_id',
                                ordinal: 2,
                                storeType: 'text',
                                isNullable: false,
                            },
                        ],
                        primaryKey: {
                            name: 'pk_account_profiles',
                            columns: ['id'],
                        },
                        indexes: [{
                            name: 'ux_account_profiles_account_id',
                            columns: ['account_id'],
                            isUnique: true,
                        }],
                        foreignKeys: [{
                            name: 'fk_account_profiles_accounts',
                            columns: ['account_id'],
                            principalSchemaName: '',
                            principalTableName: 'accounts',
                            principalColumns: ['id'],
                            onDelete: 'cascade',
                        }],
                    },
                ],
            }],
        };

        const files = generateDbPullCode(snapshot, {
            contextName: 'PulledContext',
        });
        const context = files.find(file =>
            file.path === 'pulled-context.ts')?.contents ?? '';

        expect(context).toContain('.withOne()');
    });
});

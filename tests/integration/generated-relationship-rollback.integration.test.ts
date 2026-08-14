import type {
    DbContextOptionsBuilder,
    ModelBuilder,
    PropertyBuilder,
} from '../../src';
import { DbContext } from '../../src';
import { mySqlProviderServices } from '../../src/providers/mysql';
import { postgresProviderServices } from '../../src/providers/postgres';
import { requireDefined } from '../support/require-defined';

class RollbackParent {
    public id = 0;
    public name = '';
    public children: RollbackChild[] = [];
}

class RollbackChild {
    public id = '';
    public parentId = 0;
    public parent: RollbackParent | null = null;
}

abstract class GeneratedRollbackContext extends DbContext {
    public parents = this.set(RollbackParent);
    public children = this.set(RollbackChild);

    protected abstract configureProvider(
        options: DbContextOptionsBuilder,
    ): void;

    protected abstract configureIdentity(
        property: PropertyBuilder<number>,
    ): void;

    protected override configure(options: DbContextOptionsBuilder): void {
        this.configureProvider(options);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(RollbackParent, entity => {
            entity.toTable('generated_rollback_parents');
            entity.hasKey(row => row.id);
            const id = entity.property(row => row.id)
                .hasColumnType('integer').isRequired();
            this.configureIdentity(id);
            entity.property(row => row.name).hasColumnType('text').isRequired();
        });
        model.entity(RollbackChild, entity => {
            entity.toTable('generated_rollback_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('integer').isRequired();
            entity.hasOne(RollbackParent, row => row.parent)
                .withMany(row => row.children)
                .hasForeignKey(row => row.parentId);
        });
    }
}

class PostgresGeneratedRollbackContext extends GeneratedRollbackContext {
    protected override configureProvider(
        options: DbContextOptionsBuilder,
    ): void {
        options.useProvider(
            postgresProviderServices,
            requireDefined(process.env.DATABASE_URL),
        );
    }

    protected override configureIdentity(
        property: PropertyBuilder<number>,
    ): void {
        property.useIdentityColumn();
    }
}

class MySqlGeneratedRollbackContext extends GeneratedRollbackContext {
    protected override configureProvider(
        options: DbContextOptionsBuilder,
    ): void {
        options.useProvider(
            mySqlProviderServices,
            requireDefined(
                process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL,
            ),
        );
    }

    protected override configureIdentity(
        property: PropertyBuilder<number>,
    ): void {
        property.useAutoIncrement();
    }
}

interface ProviderRuntime {
    readonly create: () => GeneratedRollbackContext;
    readonly placeholder: (index: number) => string;
}

function defineGeneratedRollbackTests(runtime: ProviderRuntime): void {
    let db: GeneratedRollbackContext;

    const query = async (
        text: string,
        values: readonly unknown[] = [],
    ): Promise<void> => {
        await db.database.connection.query({ text, values });
    };
    const dropTables = async (): Promise<void> => {
        await query('drop table if exists generated_rollback_children');
        await query('drop table if exists generated_rollback_parents');
    };
    const insertParent = async (id: number, name: string): Promise<void> => {
        await query(
            'insert into generated_rollback_parents (id, name) values ' +
            `(${runtime.placeholder(1)}, ${runtime.placeholder(2)})`,
            [id, name],
        );
    };
    const storedParentId = async (childId: string): Promise<number> => {
        const result = await db.database.connection.query<{
            parent_id: number;
        }>({
            text: 'select parent_id from generated_rollback_children ' +
                `where id = ${runtime.placeholder(1)}`,
            values: [childId],
        });
        return requireDefined(result.rows[0]).parent_id;
    };

    beforeEach(async () => {
        db = runtime.create();
        await dropTables();
        await query(db.database.createScript());
    });

    afterEach(async () => {
        await dropTables();
        await db.dispose();
    });

    it('retargets an added dependent that was never planned', async () => {
        const parent = Object.assign(new RollbackParent(), { name: 'new' });
        const child = Object.assign(new RollbackChild(), { id: 'added' });
        let rolledBackId = 0;
        await expect(db.transaction(async tx => {
            tx.parents.add(parent);
            await tx.saveChanges();
            rolledBackId = parent.id;
            child.parentId = parent.id;
            tx.children.add(child);
            throw new Error('abort before dependent plan');
        })).rejects.toThrow('abort before dependent plan');
        await insertParent(rolledBackId, 'unrelated');

        await expect(db.saveChanges()).resolves.toBe(2);
        expect(parent.id).not.toBe(rolledBackId);
        expect(child).toMatchObject({
            parentId: parent.id,
            parent,
        });
        await expect(storedParentId(child.id)).resolves.toBe(parent.id);
    });

    it('fails closed for an existing dependent that was never planned', async () => {
        await insertParent(50, 'stable');
        await query(
            'insert into generated_rollback_children (id, parent_id) values ' +
            `(${runtime.placeholder(1)}, ${runtime.placeholder(2)})`,
            ['existing', 50],
        );
        const child = requireDefined(await db.children.find('existing'));
        const parent = Object.assign(new RollbackParent(), { name: 'new' });
        let rolledBackId = 0;
        await expect(db.transaction(async tx => {
            tx.parents.add(parent);
            await tx.saveChanges();
            rolledBackId = parent.id;
            child.parentId = parent.id;
            throw new Error('abort before dependent detection');
        })).rejects.toThrow('abort before dependent detection');
        await insertParent(rolledBackId, 'unrelated');

        await expect(db.saveChanges()).rejects.toThrow(
            'has not been generated yet',
        );
        await expect(storedParentId(child.id)).resolves.toBe(50);
    });
}

const postgresEnabled = process.env.RUN_POSTGRES_TESTS === 'true' &&
    Boolean(process.env.DATABASE_URL);
(postgresEnabled ? describe : describe.skip)(
    'Postgres generated relationship rollback',
    () => {
        defineGeneratedRollbackTests({
            create: () => PostgresGeneratedRollbackContext.create(),
            placeholder: index => `$${String(index)}`,
        });
    },
);

const mysqlEnabled = process.env.RUN_MYSQL_TESTS === 'true' &&
    Boolean(process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL);
(mysqlEnabled ? describe : describe.skip)(
    'MySQL generated relationship rollback',
    () => {
        defineGeneratedRollbackTests({
            create: () => MySqlGeneratedRollbackContext.create(),
            placeholder: () => '?',
        });
    },
);

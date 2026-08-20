import type {
    DatabaseOperationOptions,
    DatabaseQueryResult,
    DbContextOptionsBuilder,
    ModelBuilder,
    SqlStatement,
} from '../packages/core/src';
import { DbContext, valueConverter } from '../packages/core/src';
import { postgresDialect } from '../packages/postgres/src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

let providerEpoch = 'one';
let tenantConversions = 0;

const tenantConverter = valueConverter<string, string>({
    toProvider: value => {
        tenantConversions += 1;
        return `${value}:${providerEpoch}`;
    },
    fromProvider: value => value.split(':')[0] ?? value,
});

class GeneratedTenantParent {
    public id!: number;
    public name = '';
}

class GeneratedTenantChild {
    public id = '';
    public parentId!: number;
    public parent!: GeneratedTenantParent;
    public tenantId = 'tenant-one';
}

class EpochChangingConnection extends RecordingDatabaseConnection {
    private queryCount = 0;
    public conversionsAfterFirstQuery?: number;
    public conversionsBeforeSecondQuery?: number;

    public override async query<
        TRow extends Record<string, unknown> = Record<string, unknown>,
    >(
        statement: SqlStatement,
        options?: DatabaseOperationOptions,
    ): Promise<DatabaseQueryResult<TRow>> {
        this.queryCount += 1;
        if (this.queryCount === 2) {
            this.conversionsBeforeSecondQuery = tenantConversions;
        }
        const result = await super.query<TRow>(statement, options);
        if (this.queryCount === 1) {
            this.conversionsAfterFirstQuery = tenantConversions;
            providerEpoch = 'two';
        }
        return result;
    }
}

class GeneratedTenantContext extends DbContext {
    public parents = this.set(GeneratedTenantParent);
    public children = this.set(GeneratedTenantChild);

    constructor(private readonly connection: RecordingDatabaseConnection) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection, {
            provider: postgresDialect.name,
            dialect: postgresDialect,
        }).useTenantScope(() => 'tenant-one');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(GeneratedTenantParent, entity => {
            entity.toTable('generated_tenant_parents');
            entity.hasKey(parent => parent.id);
            entity.property(parent => parent.id).hasColumnType('integer')
                .isRequired().valueGeneratedOnAdd();
            entity.property(parent => parent.name).hasColumnType('text')
                .isRequired();
        });
        model.entity(GeneratedTenantChild, entity => {
            entity.toTable('generated_tenant_children');
            entity.hasKey(child => child.id);
            entity.tenantKey(child => child.tenantId);
            entity.property(child => child.id).hasColumnType('text')
                .isRequired();
            entity.property(child => child.parentId).hasColumnName('parent_id')
                .hasColumnType('integer').isRequired();
            entity.property(child => child.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').hasConversion(tenantConverter)
                .isRequired();
            entity.hasOne(GeneratedTenantParent, child => child.parent)
                .withMany().hasForeignKey(child => child.parentId);
        });
    }
}

describe('generated-key tenant provider facts', () => {
    beforeEach(() => {
        providerEpoch = 'one';
        tenantConversions = 0;
    });

    it('reuses the captured tenant after awaiting the principal insert', async () => {
        const connection = new EpochChangingConnection();
        connection.queueResult({ rows: [{ id: 71 }], rowCount: 1 });
        connection.queueResult({ rowCount: 1 });
        const db = GeneratedTenantContext.create(connection);
        const parent = Object.assign(new GeneratedTenantParent(), {
            name: 'parent',
        });
        const child = Object.assign(new GeneratedTenantChild(), {
            id: 'child-one',
            parent,
        });
        db.children.add(child);
        db.parents.add(parent);

        await expect(db.saveChanges()).resolves.toBe(2);

        expect(connection.conversionsBeforeSecondQuery)
            .toBe(connection.conversionsAfterFirstQuery);
        expect(connection.statements[1]?.values).toEqual([
            'child-one',
            'tenant-one:one',
            71,
        ]);
        expect(child.parentId).toBe(71);
        await db.dispose();
    });
});

import { DbContext, type DbContextOptionsBuilder, type ModelBuilder } from '../../packages/core/src';
import type { DatabaseConnection } from '../../packages/core/src/adapter';
import { sqliteProviderServices } from '../../packages/sqlite/src';

export interface NewCreationUser {
    id: string;
    name: string;
    tenantId?: string;
    children?: CreationChild[];
}

export class CreationUser {
    public static constructions = 0;
    readonly #identity: string;
    readonly #tenant: { value?: string } = {};
    public id: string;
    public name: string;
    public status = 'new';
    public children: CreationChild[];

    constructor(input: NewCreationUser) {
        CreationUser.constructions++;
        if (!input.name.trim()) throw new Error('A name is required.');
        this.#identity = input.id;
        this.id = input.id;
        this.name = input.name.trim();
        this.#tenant.value = input.tenantId;
        this.children = input.children ?? [];
    }

    public get tenantId(): string | undefined {
        return this.#tenant.value;
    }
    public set tenantId(value: string | undefined) {
        this.#tenant.value = value;
    }
    public identity(): string {
        return this.#identity;
    }
}

export class CreationChild {
    public parent: CreationUser | null = null;
    constructor(public id: string, public userId: string) {}
}

interface CreationContextOptions {
    connection?: DatabaseConnection;
    filename?: string;
    tenant?: string;
    readOnly?: boolean;
}

export class CreationContext extends DbContext {
    public readonly users = this.set<typeof CreationUser, [id: string]>(CreationUser);
    public readonly children = this.set(CreationChild);

    constructor(private readonly configuration: CreationContextOptions = {}) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        if (this.configuration.connection) {
            options.useConnection(this.configuration.connection);
        } else {
            options.useProvider(sqliteProviderServices, this.configuration.filename ?? ':memory:');
        }
        if (this.configuration.tenant) options.useTenantScope(() => this.configuration.tenant);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(CreationUser, entity => {
            entity.toTable('creation_users');
            if (!this.configuration.readOnly) entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnType('text').isRequired();
            entity.property(user => user.name).hasColumnType('text').isRequired();
            entity.property(user => user.status).hasColumnType('text').isRequired();
            entity.property(user => user.tenantId).hasColumnType('text');
            if (this.configuration.tenant) entity.tenantKey(user => user.tenantId);
            if (this.configuration.readOnly) entity.toView('creation_users');
            entity.materialize(values => new CreationUser({
                id: values.id ?? '', name: values.name ?? '', tenantId: values.tenantId,
            }));
        });
        model.entity(CreationChild, entity => {
            entity.toTable('creation_children');
            entity.hasKey(child => child.id);
            entity.property(child => child.id).hasColumnType('text').isRequired();
            entity.property(child => child.userId).hasColumnType('text').isRequired();
            if (!this.configuration.readOnly) {
                entity.hasOne(CreationUser, child => child.parent)
                    .withMany(user => user.children).hasForeignKey(child => child.userId);
            }
            entity.materialize(values => new CreationChild(values.id ?? '', values.userId ?? ''));
        });
    }
}

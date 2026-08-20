import type { DbContextOptionsBuilder, ModelBuilder } from '../../../packages/core/src';
import { DbContext, type RuntimeDiagnosticEvent } from '../../../packages/core/src';
import type { ProviderContractRuntime } from './runtime';

export class ProviderContractUser {
    public id!: string;
    public email!: string;

    constructor(data?: Partial<ProviderContractUser>) {
        Object.assign(this, data);
    }
}

/**
 * Exercises the mapped column types whose JavaScript representation differs
 * from their storage representation. Drivers vary in how much they restore:
 * `pg` returns `boolean`/`Date`/parsed JSON itself, while SQLite returns raw
 * storage values and its provider supplies a `StoreValueReader`. Either way a
 * provider must hand back the types the model declares.
 */
export class ProviderContractValue {
    public id!: string;
    public isActive!: boolean;
    public recordedAt!: Date;
    public payload!: { unit: string; samples: number[] };
    public score!: number;
    /** Nullable so ordering and text-matching parity can be exercised. */
    public label!: string | null;

    constructor(data?: Partial<ProviderContractValue>) {
        Object.assign(this, data);
    }
}

/** A one-to-many pair with text keys, so the foreign-key column is text too. */
export class ProviderContractParent {
    public id!: string;
    public name!: string;
    public children?: ProviderContractChild[];

    constructor(data?: Partial<ProviderContractParent>) {
        Object.assign(this, data);
    }
}

export class ProviderContractChild {
    public id!: string;
    public parentId!: string;
    public score!: number;
    public parent?: ProviderContractParent;

    constructor(data?: Partial<ProviderContractChild>) {
        Object.assign(this, data);
    }
}

export class ProviderContractDbContext extends DbContext {
    public users = this.set(ProviderContractUser);
    public values = this.set(ProviderContractValue);
    public parents = this.set(ProviderContractParent);
    public children = this.set(ProviderContractChild);
    public readonly diagnosticEvents: RuntimeDiagnosticEvent[] = [];

    constructor(private readonly runtime: ProviderContractRuntime) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        this.runtime.configure(options);
        options.useDiagnostics(event => {
            this.diagnosticEvents.push(event);
        });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(ProviderContractUser, entity => {
            entity.toTable('provider_contract_users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
        });

        model.entity(ProviderContractValue, entity => {
            entity.toTable('provider_contract_values');
            entity.hasKey(value => value.id);
            entity.property(value => value.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(value => value.isActive).hasColumnName('is_active').hasColumnType('boolean').isRequired();
            entity.property(value => value.recordedAt).hasColumnName('recorded_at').hasColumnType('timestamptz').isRequired();
            entity.property(value => value.payload).hasColumnName('payload').hasColumnType('jsonb').isRequired();
            entity.property(value => value.score).hasColumnName('score').hasColumnType('integer').isRequired();
            entity.property(value => value.label).hasColumnName('label').hasColumnType('text');
        });

        model.entity(ProviderContractParent, entity => {
            entity.toTable('provider_contract_parents');
            entity.hasKey(parent => parent.id);
            entity.property(parent => parent.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(parent => parent.name).hasColumnName('name').hasColumnType('text').isRequired();
        });

        model.entity(ProviderContractChild, entity => {
            entity.toTable('provider_contract_children');
            entity.hasKey(child => child.id);
            entity.property(child => child.id).hasColumnName('id').hasColumnType('text').isRequired();
            // A text foreign-key column: only bounded to a keyable type on MySQL.
            entity.property(child => child.parentId).hasColumnName('parent_id').hasColumnType('text').isRequired();
            entity.property(child => child.score).hasColumnName('score').hasColumnType('integer').isRequired();
            entity.hasOne(ProviderContractParent, child => child.parent)
                .withMany(parent => parent.children)
                .hasForeignKey(child => child.parentId);
        });
    }

    public static async createWith(runtime: ProviderContractRuntime): Promise<ProviderContractDbContext> {
        const context = ProviderContractDbContext.create(runtime);
        await runtime.beforeEach?.(context);
        context.diagnosticEvents.length = 0;
        return context;
    }
}

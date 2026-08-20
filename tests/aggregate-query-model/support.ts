import { ModelBuilder as ModelBuilderImplementation } from '../../packages/core/src/model/model-builder';
import type { DbContextOptionsBuilder , ModelBuilder } from '../../packages/core/src';
import type { EntityMetadata } from '../../packages/core/src/model/entity-metadata';
import { DbContext } from '../../packages/core/src';
import type { SqlDialect } from '../../packages/core/src/adapter';
import type { QueryExecutor, QueryModel } from '../../packages/core/src/experimental';
import { RecordingDatabaseConnection } from '../support/recording-database-connection';

export class Order {
    public id!: string;
    public workspaceId!: string;
    public customerEmail!: string;
    public totalCents!: number;
    public paidAt!: Date | null;
    public createdAt!: Date;
    public archivedAt!: Date | null;
}

export function createOrderMetadata(): EntityMetadata<Order> {
    const model = new ModelBuilderImplementation();
    configureOrderModel(model);
    return model.build().getEntity(Order);
}

export class AggregateDbContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public static dialect?: SqlDialect;
    public static tenantId = 'wrk_1';

    public orders = this.set(Order);

    protected override configure(options: DbContextOptionsBuilder): void {
        if (AggregateDbContext.dialect) {
            options.useConnection(AggregateDbContext.connection, {
                provider: 'custom',
                dialect: AggregateDbContext.dialect,
            });
        } else {
            options.useConnection(AggregateDbContext.connection);
        }
        options.useTenantScope(() => AggregateDbContext.tenantId);
    }

    protected override model(model: ModelBuilder): void {
        configureOrderModel(model);
    }
}

export function createDb(connection = new RecordingDatabaseConnection(), dialect?: SqlDialect): AggregateDbContext {
    AggregateDbContext.connection = connection;
    AggregateDbContext.dialect = dialect;
    AggregateDbContext.tenantId = 'wrk_1';
    return AggregateDbContext.create();
}

export class RecordingExecutor implements QueryExecutor<Order> {
    public models: Array<QueryModel<Order>> = [];

    public async executeToArray(model: QueryModel<Order>): Promise<Order[]> {
        this.models.push(model);
        return Promise.resolve([]);
    }

    public async executeCount(model: QueryModel<Order>): Promise<number> {
        this.models.push(model);
        return Promise.resolve(0);
    }

    public async executeExists(model: QueryModel<Order>): Promise<boolean> {
        this.models.push(model);
        return Promise.resolve(false);
    }

    public async executeProjectionToArray<TProjection extends Record<string, unknown>>(model: QueryModel<Order>): Promise<TProjection[]> {
        this.models.push(model);
        return Promise.resolve([]);
    }

    public async executeAggregateToArray<TProjection extends Record<string, unknown>>(model: QueryModel<Order>): Promise<TProjection[]> {
        this.models.push(model);
        return Promise.resolve([]);
    }
}

function configureOrderModel(model: ModelBuilder): void {
    model.entity(Order, entity => {
        entity.toTable('orders');
        entity.hasKey(order => order.id);
        entity.property(order => order.id).hasColumnName('id').hasColumnType('text').isRequired();
        entity.property(order => order.workspaceId).hasColumnName('workspace_id').hasColumnType('text').isRequired();
        entity.property(order => order.customerEmail).hasColumnName('customer_email').hasColumnType('text').isRequired();
        entity.property(order => order.totalCents).hasColumnName('total_cents').hasColumnType('integer').isRequired();
        entity.property(order => order.paidAt).hasColumnName('paid_at').hasColumnType('timestamptz');
        entity.property(order => order.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired();
        entity.property(order => order.archivedAt).hasColumnName('archived_at').hasColumnType('timestamptz');
        entity.tenantKey(order => order.workspaceId);
        entity.softDelete(order => order.archivedAt);
    });
}

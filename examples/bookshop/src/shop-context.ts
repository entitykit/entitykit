import { DbContext, type DbContextOptionsBuilder, type EntityKitDataSource, type ModelBuilder } from '@entitykit/core';
import { AuditRecord, CommandReceipt, Inventory, Order, OutboxRecord } from './shop-entities';
import { configureShopModel } from './shop-model';

export class ShopContext extends DbContext {
    public inventory = this.set<Inventory, [tenantId: string, sku: string]>(Inventory);
    public orders = this.set<Order, [tenantId: string, id: string]>(Order);
    public receipts = this.set<CommandReceipt, [tenantId: string, requestId: string]>(CommandReceipt);
    public audit = this.set<AuditRecord, [tenantId: string, id: string]>(AuditRecord);
    // The delivery worker owns this unscoped queue; request handlers use checkout().
    public outbox = this.set<OutboxRecord, [id: number]>(OutboxRecord);

    constructor(
        private readonly source: EntityKitDataSource<object>,
        public readonly tenantId: string,
        public readonly actorId: string,
    ) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useDataSource(this.source).useTenantScope(() => this.tenantId)
            .useAuditing({ currentUserId: () => this.actorId })
            .useOutbox({
                tableName: 'bookshop_outbox',
                collectEvents: entity => entity instanceof Order ? entity.events : [],
                clearEvents: (entity, persisted) => {
                    if (entity instanceof Order) {
                        entity.events = entity.events.filter(event => !persisted.includes(event));
                    }
                },
            });
    }

    protected override model(model: ModelBuilder): void {
        configureShopModel(model, this.source.providerName);
    }
}

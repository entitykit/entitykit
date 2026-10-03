import type { EntityBuilder, EntityPropertyKey, ModelBuilder } from '@entitykit/core';
import { AuditRecord, CommandReceipt, Inventory, Order, OutboxRecord } from './shop-entities';

export function configureShopModel(model: ModelBuilder, provider: string): void {
    const timestamp = provider === 'postgres' ? 'timestamptz' : 'datetime(3)';
    model.entity(Inventory, entity => {
        entity.toTable('bookshop_inventory').hasKey(row => [row.tenantId, row.sku]);
        tenant(entity);
        text(entity, 'sku');
        entity.property(row => row.available).hasColumnType('integer').isRequired();
        entity.property(row => row.version).hasColumnType('integer').isRequired().isVersion();
        entity.property(row => row.updatedAt).hasColumnType(timestamp).isRequired();
        text(entity, 'updatedBy');
        entity.audit({ updatedAt: row => row.updatedAt, updatedBy: row => row.updatedBy });
        entity.hasCheckConstraint('bookshop_stock_nonnegative', 'available >= 0');
    });
    model.entity(Order, entity => {
        entity.toTable('bookshop_orders').hasKey(row => [row.tenantId, row.id]);
        tenant(entity);
        text(entity, 'id');
        text(entity, 'sku');
        entity.property(row => row.quantity).hasColumnType('integer').isRequired();
        entity.property(row => row.version).hasColumnType('integer').isRequired().isVersion();
        entity.property(row => row.createdAt).hasColumnType(timestamp).isRequired();
        text(entity, 'createdBy');
        entity.audit({ createdAt: row => row.createdAt, createdBy: row => row.createdBy });
        entity.ignore(row => row.events);
        entity.hasCheckConstraint('bookshop_quantity_positive', 'quantity > 0');
    });
    model.entity(CommandReceipt, entity => {
        entity.toTable('bookshop_receipts').hasKey(row => [row.tenantId, row.requestId]);
        tenant(entity);
        text(entity, 'requestId');
        text(entity, 'fingerprint');
        text(entity, 'orderId');
        entity.property(row => row.response).hasColumnType('text').isRequired();
    });
    model.entity(AuditRecord, entity => {
        entity.toTable('bookshop_audit').hasKey(row => [row.tenantId, row.id]);
        tenant(entity);
        text(entity, 'id');
        text(entity, 'orderId');
        text(entity, 'actorId');
        text(entity, 'action');
        entity.property(row => row.occurredAt).hasColumnType(timestamp).isRequired();
    });
    model.entity(OutboxRecord, entity => {
        entity.toTable('bookshop_outbox').hasKey(row => row.id);
        const id = entity.property(row => row.id).hasColumnType('integer').isRequired();
        if (provider === 'sqlite') id.useSqliteRowId();
        else if (provider === 'mysql') id.useAutoIncrement();
        else id.useIdentityColumn();
        text(entity, 'type');
        entity.property(row => row.payload).hasColumnType('text').isRequired();
        entity.property(row => row.aggregateId).hasColumnName('aggregate_id')
            .hasColumnType('varchar(256)').isRequired();
        entity.property(row => row.occurredAt).hasColumnName('occurred_at')
            .hasColumnType(timestamp).isRequired();
        entity.property(row => row.delivered).hasColumnType('integer').isRequired().hasDefaultValue(0);
    });
}

function tenant<TEntity extends { tenantId: string }>(entity: EntityBuilder<TEntity>): void {
    entity.property(row => row.tenantId).hasColumnType('varchar(64)').isRequired();
    entity.tenantKey(row => row.tenantId);
}

function text<TEntity extends object>(entity: EntityBuilder<TEntity>, property: EntityPropertyKey<TEntity>): void {
    entity.property(property).hasColumnType('varchar(64)').isRequired();
}

import type { ModelBuilder } from '@entitykit/core';
import { DeliveryReceipt, Shipment } from './shop-entities';

export function configureDeliveryModel(model: ModelBuilder): void {
    model.entity(DeliveryReceipt, entity => {
        entity.toTable('bookshop_delivery_receipts').hasKey(row => [row.tenantId, row.eventId]);
        entity.tenantKey(row => row.tenantId);
        entity.property(row => row.tenantId).hasColumnType('varchar(64)').isRequired();
        entity.property(row => row.eventId).hasColumnType('varchar(64)').isRequired();
        entity.property(row => row.fingerprint).hasColumnType('varchar(64)').isRequired();
    });
    model.entity(Shipment, entity => {
        entity.toTable('bookshop_shipments').hasKey(row => [row.tenantId, row.orderId]);
        entity.tenantKey(row => row.tenantId);
        entity.property(row => row.tenantId).hasColumnType('varchar(64)').isRequired();
        entity.property(row => row.orderId).hasColumnType('varchar(64)').isRequired();
        entity.property(row => row.sku).hasColumnType('varchar(64)').isRequired();
        entity.property(row => row.quantity).hasColumnType('integer').isRequired();
        entity.property(row => row.status).hasColumnType('varchar(64)').isRequired();
    });
}

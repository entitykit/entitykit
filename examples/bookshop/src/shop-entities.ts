import type { OutboxMessage } from '@entitykit/core';

export class Inventory {
    public tenantId = '';
    public sku = '';
    public available = 0;
    public version = 1;
    public updatedAt = new Date();
    public updatedBy = '';
}

export class Order {
    public tenantId = '';
    public id = '';
    public sku = '';
    public quantity = 0;
    public version = 1;
    public createdAt!: Date;
    public createdBy!: string;
    public events: OutboxMessage[] = [];
}

export class CommandReceipt {
    public tenantId = '';
    public requestId = '';
    public fingerprint = '';
    public orderId = '';
    public response = '';
}

export class AuditRecord {
    public tenantId = '';
    public id = '';
    public orderId = '';
    public actorId = '';
    public action = '';
    public occurredAt = new Date();
}

export class OutboxRecord {
    public id!: number;
    public type = '';
    public payload = '';
    public aggregateId = '';
    public occurredAt = new Date();
    public delivered = 0;
}

export class DeliveryReceipt {
    public tenantId = '';
    public eventId = '';
    public fingerprint = '';
}

export class Shipment {
    public tenantId = '';
    public orderId = '';
    public sku = '';
    public quantity = 0;
    public status = 'requested';
}

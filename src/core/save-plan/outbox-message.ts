import type { OutboxMessage, OutboxOptions } from '../outbox-options';
import type {
    OutboxEventBatch,
    OutboxEventTracker,
} from '../outbox-event-tracker';
import type { PersistedValueLookup } from '../save-plan-execution';
import type { EntityEntry } from '../../tracking/entity-entry';
import { cloneSnapshotValue } from '../../tracking/entity-entry';
import { readSynchronousDate } from '../../synchronous-value';

export interface PendingOutboxMessage {
    readonly entity: object;
    readonly event: OutboxMessage;
    readonly keyValue: unknown;
    readonly entry: EntityEntry<object>;
    readonly type: string;
    readonly payload: unknown;
    readonly aggregateId: unknown;
    readonly aggregateKeyValues: readonly unknown[];
    readonly occurredAt: Date;
}

interface CollectionOptions {
    readonly outbox: OutboxOptions;
    readonly entries: ReadonlyArray<EntityEntry<object>>;
    readonly eventTracker: OutboxEventTracker;
    readonly currentAuditTimestamp: () => Date;
}

export function collectPendingOutboxMessages(
    options: CollectionOptions,
): PendingOutboxMessage[] {
    const messages: PendingOutboxMessage[] = [];
    for (const entry of options.entries) {
        const events = options.eventTracker.pending(
            entry.entity,
            options.outbox.collectEvents(entry.entity),
        );
        for (const event of events) {
            messages.push({
                entity: entry.entity,
                event,
                keyValue: event.aggregateId ?? entry.keyValue,
                entry,
                type: event.type,
                payload: cloneSnapshotValue(event.payload),
                aggregateId: cloneSnapshotValue(event.aggregateId),
                aggregateKeyValues: entry.metadata.keyProperties.map(
                    propertyName => cloneSnapshotValue(
                        entry.currentValues()[propertyName],
                    ),
                ),
                occurredAt: new Date((
                    event.occurredAt ??
                    readSynchronousDate(options.outbox.now, 'The outbox clock') ??
                    options.currentAuditTimestamp()
                ).getTime()),
            });
        }
    }
    return messages;
}

export function outboxEventBatches(
    messages: readonly PendingOutboxMessage[],
): OutboxEventBatch[] {
    const eventsByEntity: Map<object, OutboxMessage[]> = new Map();
    for (const message of messages) {
        const events = eventsByEntity.get(message.entity) ?? [];
        events.push(message.event);
        eventsByEntity.set(message.entity, events);
    }
    return [...eventsByEntity].map(([entity, events]) => ({ entity, events }));
}

export function persistedAggregateId(
    message: PendingOutboxMessage,
    persistedValue?: PersistedValueLookup,
): unknown {
    const keyValues = message.entry.metadata.keyProperties.map(
        (propertyName, index) =>
            persistedValue?.(message.entity, propertyName)?.persistedValue ??
                message.aggregateKeyValues[index],
    );
    return keyValues.length === 1 ? keyValues[0] : keyValues;
}

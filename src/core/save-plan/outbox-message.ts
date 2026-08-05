import type { OutboxMessage, OutboxOptions } from '../outbox-options';
import type {
    OutboxEventBatch,
    OutboxEventTracker,
} from '../outbox-event-tracker';
import type { PersistedValueLookup } from '../save-plan-execution';
import type { EntityEntry } from '../../tracking/entity-entry';
import { cloneSnapshotValue } from '../../tracking/entity-entry';
import {
    readSynchronousDate,
    readSynchronousValue,
} from '../../synchronous-value';
import {
    normalizeJsonValue,
    serializeJsonValue,
    type JsonPrimitive,
} from '../../json-value';

export interface PendingOutboxMessage {
    readonly entity: object;
    readonly event: OutboxMessage;
    readonly keyValue: unknown;
    readonly entry: EntityEntry<object>;
    readonly type: string;
    readonly serializedPayload: string;
    readonly hasExplicitAggregateId: boolean;
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
        const collectedEvents = readSynchronousValue(
            () => options.outbox.collectEvents(entry.entity),
            'The outbox collectEvents callback',
        );
        if (!Array.isArray(collectedEvents)) {
            throw new TypeError(
                'The outbox collectEvents callback must return an array.',
            );
        }
        const events = options.eventTracker.pending(
            entry.entity,
            collectedEvents,
        );
        for (const event of events) {
            messages.push({
                entity: entry.entity,
                event,
                keyValue: event.aggregateId === undefined
                    ? entry.keyValue
                    : event.aggregateId,
                entry,
                type: event.type,
                serializedPayload: serializeJsonValue(
                    event.payload,
                    outboxValuePath(event, 'payload'),
                ),
                hasExplicitAggregateId: event.aggregateId !== undefined,
                aggregateId: event.aggregateId === undefined
                    ? undefined
                    : normalizeAggregateId(
                        event.aggregateId,
                        outboxValuePath(event, 'aggregateId'),
                    ),
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

export function normalizeAggregateId(
    value: unknown,
    path: string,
): JsonPrimitive {
    const normalized = normalizeJsonValue(value, path);
    return typeof normalized === 'object' && normalized !== null
        ? JSON.stringify(normalized)
        : normalized;
}

function outboxValuePath(
    event: OutboxMessage,
    field: 'payload' | 'aggregateId',
): string {
    return `Outbox event "${event.type}" ${field}`;
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

import type { OutboxMessage, OutboxOptions } from '../outbox-options';
import type {
    OutboxEventBatch,
    OutboxEventTracker,
} from '../outbox-event-tracker';
import type { EntityEntry } from '../../tracking/entity-entry';
import {
    readSynchronousDate,
    readSynchronousValue,
    assertValidDate,
} from '../../synchronous-value';
import {
    serializeJsonValue,
} from '../../json-value';
import {
    captureAggregateId,
    formatExplicitAggregateId,
    type PendingAggregateId,
} from './outbox-aggregate-id';

export interface PendingOutboxMessage {
    readonly entity: object;
    readonly event: OutboxMessage;
    readonly keyValue: unknown;
    readonly entry: EntityEntry<object>;
    readonly type: string;
    readonly serializedPayload: string;
    readonly hasExplicitAggregateId: boolean;
    readonly aggregateId: unknown;
    readonly pendingAggregateId?: PendingAggregateId;
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
                    : formatExplicitAggregateId(
                        event.aggregateId,
                        outboxValuePath(event, 'aggregateId'),
                    ),
                pendingAggregateId: event.aggregateId === undefined
                    ? captureAggregateId(entry)
                    : undefined,
                occurredAt: outboxOccurredAt(event, options),
            });
        }
    }
    return messages;
}

function outboxOccurredAt(
    event: OutboxMessage,
    options: CollectionOptions,
): Date {
    const value = event.occurredAt ??
        readSynchronousDate(options.outbox.now, 'The outbox clock') ??
        options.currentAuditTimestamp();
    assertValidDate(
        value,
        `Outbox event "${event.type}" occurredAt must be a valid Date.`,
    );
    return new Date(value.getTime());
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

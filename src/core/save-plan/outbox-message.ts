import type { OutboxMessage, OutboxOptions } from '../outbox-options';
import type {
    OutboxEventBatch,
    OutboxEventTracker,
} from '../outbox-event-tracker';
import type { PersistedEntrySnapshot } from '../../tracking/persisted-entry-snapshot';
import { persistedEntryKeyValue } from '../../tracking/persisted-entry-snapshot';
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
    readonly type: string;
    readonly serializedPayload: string;
    readonly hasExplicitAggregateId: boolean;
    readonly aggregateId: unknown;
    readonly pendingAggregateId?: PendingAggregateId;
    readonly occurredAt: Date;
}

interface CollectionOptions {
    readonly outbox: OutboxOptions;
    readonly entries: readonly PersistedEntrySnapshot[];
    readonly eventTracker: OutboxEventTracker;
    readonly currentAuditTimestamp: () => Date;
}

export function collectPendingOutboxMessages(
    options: CollectionOptions,
): PendingOutboxMessage[] {
    const messages: PendingOutboxMessage[] = [];
    for (const snapshot of options.entries) {
        const { entry } = snapshot;
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
            const type = event.type;
            const payload = event.payload;
            const aggregateId = event.aggregateId;
            const occurredAt = event.occurredAt;
            const hasExplicitAggregateId = aggregateId !== undefined;
            messages.push({
                entity: entry.entity,
                event,
                keyValue: hasExplicitAggregateId
                    ? aggregateId
                    : persistedEntryKeyValue(snapshot),
                type,
                serializedPayload: serializeJsonValue(
                    payload,
                    outboxValuePath(type, 'payload'),
                ),
                hasExplicitAggregateId,
                aggregateId: hasExplicitAggregateId
                    ? formatExplicitAggregateId(
                        aggregateId,
                        outboxValuePath(type, 'aggregateId'),
                    )
                    : undefined,
                pendingAggregateId: hasExplicitAggregateId
                    ? undefined
                    : captureAggregateId(snapshot),
                occurredAt: outboxOccurredAt(
                    type,
                    occurredAt,
                    options,
                ),
            });
        }
    }
    return messages;
}

function outboxOccurredAt(
    type: string,
    occurredAt: Date | undefined,
    options: CollectionOptions,
): Date {
    const value = occurredAt ??
        readSynchronousDate(options.outbox.now, 'The outbox clock') ??
        options.currentAuditTimestamp();
    assertValidDate(
        value,
        `Outbox event "${type}" occurredAt must be a valid Date.`,
    );
    return new Date(value.getTime());
}

function outboxValuePath(
    type: string,
    field: 'payload' | 'aggregateId',
): string {
    return `Outbox event "${type}" ${field}`;
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

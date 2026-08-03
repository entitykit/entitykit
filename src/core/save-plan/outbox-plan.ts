import type { OutboxOptions } from '../outbox-options';
import type { ModificationSqlBuilder } from '../../sql/modification-sql-builder';
import type { EntityEntry } from '../../tracking/entity-entry';
import { EntityState } from '../../tracking/entity-state';
import type {
    OutboxEventBatch,
    OutboxEventTracker,
} from '../outbox-event-tracker';
import type { SavePlanEntry } from '../save-plan';
import { registerSavePlanExecution } from '../save-plan-execution';
import type { SqlStatement } from '../../sql/sql-statement';

interface OutboxPlanOptions {
    readonly sql: ModificationSqlBuilder;
    readonly outbox: OutboxOptions | undefined;
    readonly entries: ReadonlyArray<EntityEntry<object>>;
    readonly eventTracker: OutboxEventTracker;
    readonly currentAuditTimestamp: () => Date;
}

interface PendingOutboxMessage {
    readonly entity: object;
    readonly keyValue: unknown;
    readonly entry: EntityEntry<object>;
    readonly type: string;
    readonly payload: unknown;
    readonly aggregateId: unknown;
    readonly occurredAt: Date;
}

/** Collect pending domain events and batch them into one outbox plan entry. */
export function buildOutboxSavePlan(options: OutboxPlanOptions): SavePlanEntry[] {
    const { outbox } = options;
    if (!outbox) {
        return [];
    }

    const tableName = outbox.tableName ?? 'outbox_messages';
    const typeColumn = outbox.typeColumn ?? 'type';
    const payloadColumn = outbox.payloadColumn ?? 'payload';
    const aggregateIdColumn = outbox.aggregateIdColumn ?? 'aggregate_id';
    const occurredAtColumn = outbox.occurredAtColumn ?? 'occurred_at';
    const messages: PendingOutboxMessage[] = [];
    const batches: OutboxEventBatch[] = [];
    for (const entry of options.entries) {
        const events = options.eventTracker.pending(
            entry.entity,
            outbox.collectEvents(entry.entity),
        );
        if (events.length === 0) {
            continue;
        }

        batches.push({ entity: entry.entity, events });
        for (const event of events) {
            messages.push({
                entity: entry.entity,
                keyValue: event.aggregateId ?? entry.keyValue,
                entry,
                type: event.type,
                payload: event.payload,
                aggregateId: event.aggregateId,
                occurredAt: event.occurredAt ?? outbox.now?.() ?? options.currentAuditTimestamp(),
            });
        }
    }

    if (messages.length === 0) {
        return [];
    }

    const buildStatement = (): SqlStatement => options.sql.buildInsertOutboxMessagesBatch({
        schemaName: outbox.schemaName,
        tableName,
        typeColumn,
        payloadColumn,
        aggregateIdColumn,
        occurredAtColumn,
        messages: messages.map(message => ({
            type: message.type,
            payload: message.payload,
            aggregateId: message.aggregateId ?? message.entry.keyValue,
            occurredAt: message.occurredAt,
        })),
    });
    const planEntry: SavePlanEntry = {
        entity: messages[0].entity,
        entityName: 'OutboxMessage',
        keyValue: messages.length === 1 ? messages[0].keyValue : `${String(messages.length)} messages`,
        state: EntityState.Added,
        statement: buildStatement(),
        expectedAffectedRows: messages.length,
        isSystemGenerated: true,
    };
    registerSavePlanExecution(planEntry, { buildStatement });
    options.eventTracker.associate(planEntry, batches);
    return [planEntry];
}

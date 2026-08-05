import type { OutboxOptions } from '../outbox-options';
import type { ModificationSqlBuilder } from '../../sql/modification-sql-builder';
import type { SqlDialect } from '../../sql/sql-dialect';
import type { EntityEntry } from '../../tracking/entity-entry';
import { EntityState } from '../../tracking/entity-state';
import type { OutboxEventTracker } from '../outbox-event-tracker';
import type { SavePlanEntry } from '../save-plan';
import {
    type PersistedValueLookup,
    registerSavePlanExecution,
} from '../save-plan-execution';
import type { SqlStatement } from '../../sql/sql-statement';
import { maxParameterBatchSize } from './parameter-batch-size';
import {
    collectPendingOutboxMessages,
    outboxEventBatches,
    type PendingOutboxMessage,
} from './outbox-message';
import { formatPendingAggregateId } from './outbox-aggregate-id';

interface OutboxPlanOptions {
    readonly sql: ModificationSqlBuilder;
    readonly dialect: SqlDialect;
    readonly outbox: OutboxOptions | undefined;
    readonly entries: ReadonlyArray<EntityEntry<object>>;
    readonly eventTracker: OutboxEventTracker;
    readonly currentAuditTimestamp: () => Date;
}

/** Collect pending domain events into provider-legal outbox plan entries. */
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
    const messages = collectPendingOutboxMessages({
        outbox,
        entries: options.entries,
        eventTracker: options.eventTracker,
        currentAuditTimestamp: options.currentAuditTimestamp,
    });

    if (messages.length === 0) {
        return [];
    }

    const parametersPerMessage = 4;
    const batchSize = maxParameterBatchSize(
        options.dialect,
        parametersPerMessage,
    );
    const plan: SavePlanEntry[] = [];
    for (let index = 0; index < messages.length; index += batchSize) {
        const batch = messages.slice(index, index + batchSize);
        const planEntry = buildOutboxPlanEntry(options, {
            outbox,
            tableName,
            typeColumn,
            payloadColumn,
            aggregateIdColumn,
            occurredAtColumn,
            messages: batch,
        });
        options.eventTracker.associate(planEntry, outboxEventBatches(batch));
        plan.push(planEntry);
    }
    return plan;
}

interface OutboxPlanEntryOptions {
    readonly outbox: OutboxOptions;
    readonly tableName: string;
    readonly typeColumn: string;
    readonly payloadColumn: string;
    readonly aggregateIdColumn: string | undefined;
    readonly occurredAtColumn: string | undefined;
    readonly messages: readonly PendingOutboxMessage[];
}

function buildOutboxPlanEntry(
    options: OutboxPlanOptions,
    entryOptions: OutboxPlanEntryOptions,
): SavePlanEntry {
    const buildStatement = (
        persistedValue?: PersistedValueLookup,
    ): SqlStatement => options.sql.buildInsertOutboxMessagesBatch({
        schemaName: entryOptions.outbox.schemaName,
        tableName: entryOptions.tableName,
        typeColumn: entryOptions.typeColumn,
        payloadColumn: entryOptions.payloadColumn,
        aggregateIdColumn: entryOptions.aggregateIdColumn,
        occurredAtColumn: entryOptions.occurredAtColumn,
        messages: entryOptions.messages.map(message => {
            const aggregateId = message.hasExplicitAggregateId
                ? message.aggregateId
                : formatPendingAggregateId(
                    requirePendingAggregateId(message),
                    persistedValue,
                );
            return {
                type: message.type,
                serializedPayload: message.serializedPayload,
                aggregateId,
                occurredAt: new Date(message.occurredAt.getTime()),
            };
        }),
    });
    const planEntry: SavePlanEntry = {
        entity: entryOptions.messages[0].entity,
        entityName: 'OutboxMessage',
        keyValue: entryOptions.messages.length === 1
            ? entryOptions.messages[0].keyValue
            : `${String(entryOptions.messages.length)} messages`,
        state: EntityState.Added,
        statement: buildStatement(),
        expectedAffectedRows: entryOptions.messages.length,
        isSystemGenerated: true,
    };
    registerSavePlanExecution(planEntry, { buildStatement });
    return planEntry;
}

function requirePendingAggregateId(
    message: PendingOutboxMessage,
): NonNullable<PendingOutboxMessage['pendingAggregateId']> {
    if (!message.pendingAggregateId) {
        throw new Error('Automatic outbox aggregate identity metadata is missing.');
    }
    return message.pendingAggregateId;
}

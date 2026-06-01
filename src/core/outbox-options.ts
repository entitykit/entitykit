/** Domain event shape collected for the transactional outbox. */
export interface OutboxMessage {
    /** The type. */ readonly type: string;
    /** The payload. */ readonly payload: unknown;
    /** The aggregate id. */ readonly aggregateId?: unknown;
    /** The occurred at. */ readonly occurredAt?: Date;
}

/** Maps collected domain events to the configured outbox table. */
export interface OutboxOptions {
    /** The table name. */ readonly tableName?: string;
    /** The schema name. */ readonly schemaName?: string;
    /** The type column. */ readonly typeColumn?: string;
    /** The payload column. */ readonly payloadColumn?: string;
    /** The aggregate id column. */ readonly aggregateIdColumn?: string;
    /** The occurred at column. */ readonly occurredAtColumn?: string;
    /**
   * Return the entity's queued event objects. Keep each object's identity
   * stable until `clearEvents` receives it after commit.
   */
    readonly collectEvents: (entity: object) => readonly OutboxMessage[];
    /**
   * Remove only the events whose outbox rows committed.
   *
   * An entity can raise another event before an explicit transaction commits;
   * clearing the whole collection there would silently lose that later event.
   */
    readonly clearEvents?: (
        entity: object,
        persistedEvents: readonly OutboxMessage[],
    ) => void;
    /** The now. */ readonly now?: () => Date;
}

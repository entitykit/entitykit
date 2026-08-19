import type { DatabaseConnection } from '../storage/database-connection';
import type { StoreValueReader } from '../storage/store-value-reader';
import type { ChangeTracker } from '../tracking/change-tracker';

export interface RawSqlQueryHost {
    readonly database: DatabaseConnection;
    readonly changeTracker: ChangeTracker;
    readonly valueReader: StoreValueReader | undefined;

    assertCanQuery(operation: string): void;
}

import type { DatabaseConnection } from '../../storage/database-connection';
import type { ChangeTracker } from '../../tracking/change-tracker';
import type { DbContextOptions } from '../context-options/db-context-option-types';
import type { ManyToManyChangeSet } from '../many-to-many-change-set';
import type { OutboxEventTracker } from '../outbox-event-tracker';
import type { SaveTimeWrites } from '../save-time-writes';
import type { TransactionCoordinator } from '../transaction-coordinator';

export interface UnitOfWorkSaverDeps {
    readonly changeTracker: ChangeTracker;
    readonly saveTimeWrites: SaveTimeWrites;
    readonly manyToMany: ManyToManyChangeSet;
    readonly outboxEvents: OutboxEventTracker;
    readonly transactionCoordinator: TransactionCoordinator;
    readonly getDatabase: () => DatabaseConnection;
    readonly getOptions: () => DbContextOptions;
}

import type { SqlStatement } from '../sql/sql-statement';
import type { TransactionOptions } from '../storage/database-connection';

/**
 * Recorded operation emitted by `RecordingDatabaseConnection`.
 */
export interface RecordedDatabaseOperation {
    /** The kind. */ readonly kind:
    | 'query'
    | 'stream'
    | 'begin'
    | 'commit'
    | 'rollback'
    | 'savepoint'
    | 'release-savepoint'
    | 'rollback-to-savepoint'
    | 'session-start'
    | 'session-end';
    /** Parameterized SQL statement associated with this operation. */ readonly statement?: SqlStatement;
    /** The savepoint name. */ readonly savepointName?: string;
    /** The transaction options. */ readonly transactionOptions?: TransactionOptions;
}

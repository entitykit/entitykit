import type { DbContextOptions } from './context-options/db-context-option-types';
import type { EntityConstructor } from '../types';
import type { DbSet } from './db-set';
import type { Model } from '../model/model';
import type { DatabaseConnection } from '../storage/database-connection';
import { GuardedDatabaseConnection } from '../storage/guarded-database-connection';
import {
    ContextConcurrentOperationError,
    ContextNotInitializedError,
    ContextStateRestorationError,
} from '../errors/runtime-errors';

/**
 * Mutable lifecycle state owned by one context instance.
 *
 * Keeping the state transitions here leaves the public context stages focused
 * on the capabilities they expose instead of repeating initialization checks.
 */
export class DbContextState {
    private contextOptions?: DbContextOptions;
    private contextModel?: Model;
    private databaseConnection?: GuardedDatabaseConnection;
    private stateRestorationFailure?: ContextStateRestorationError;
    private readonly sets: Map<EntityConstructor<object>, DbSet<object>> = new Map();
    public initialized = false;
    public disposed = false;

    public get options(): DbContextOptions {
        if (!this.initialized || !this.contextOptions) {
            throw new ContextNotInitializedError();
        }
        return this.contextOptions;
    }

    public get database(): DatabaseConnection {
        if (!this.initialized || !this.databaseConnection) {
            throw new ContextNotInitializedError();
        }
        this.assertUsable();
        this.databaseConnection.assertUsable();
        return this.databaseConnection;
    }

    public get model(): Model {
        if (!this.initialized || !this.contextModel) {
            throw new ContextNotInitializedError();
        }
        return this.contextModel;
    }

    public initialize(options: DbContextOptions, model: Model): void {
        const connection = new GuardedDatabaseConnection(options.connection);
        this.contextOptions = { ...options, connection };
        this.databaseConnection = connection;
        this.contextModel = model;
        this.initialized = true;
    }

    public findSet<TEntity extends object>(
        entityType: EntityConstructor<TEntity>,
    ): DbSet<TEntity> | undefined {
        return this.sets.get(
            entityType,
        ) as DbSet<TEntity> | undefined;
    }

    public addSet<TEntity extends object>(
        entityType: EntityConstructor<TEntity>,
        set: DbSet<TEntity>,
    ): void {
        this.sets.set(
            entityType,
            set as unknown as DbSet<object>,
        );
    }

    public markStateRestorationFailure(
        phase: 'commit' | 'rollback',
        cause: unknown,
    ): void {
        this.stateRestorationFailure ??=
            new ContextStateRestorationError(phase, cause);
    }

    public assertUsable(): void {
        if (this.stateRestorationFailure) {
            throw this.stateRestorationFailure;
        }
    }

    private get databaseOperationInProgress(): boolean {
        return this.databaseConnection?.isOperationInProgress ?? false;
    }

    public assertCanDispose(contextTransactionDepth: number): void {
        if (contextTransactionDepth > 0) {
            throw new ContextConcurrentOperationError(
                'context disposal',
                'DbContext cannot be disposed while a transaction is open. Let transaction(...) return first — it commits or rolls back on the way out.',
            );
        }
        if (this.databaseOperationInProgress) {
            throw new ContextConcurrentOperationError(
                'context disposal',
                'DbContext cannot be disposed while a database operation is active. Await the operation before disposing the context.',
            );
        }
    }

    public async disposeConnection(): Promise<void> {
        const connection = this.databaseConnection;
        if (this.contextOptions?.ownsConnection && connection) {
            await connection.dispose();
        }
    }
}

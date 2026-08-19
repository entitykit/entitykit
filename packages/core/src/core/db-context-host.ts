import type { DbContextOptionsBuilder } from './context-options/db-context-options-builder';
import { DbContextUnitOfWork } from './db-context-unit-of-work';
import type { ModelBuilder } from '../model/model-builder';
import type { DatabaseConnection } from '../storage/database-connection';

/** Internal runtime host behind the application-facing DbContext class. */
export class DbContextHost extends DbContextUnitOfWork {
    constructor(
        private readonly configureOwner: (options: DbContextOptionsBuilder) => unknown,
        private readonly modelOwner: (model: ModelBuilder) => unknown,
    ) {
        super();
    }

    public get connection(): DatabaseConnection {
        return this.databaseConnection;
    }

    public initializeContext(): void {
        this.initialize();
    }

    protected override configure(options: DbContextOptionsBuilder): unknown {
        return this.configureOwner(options);
    }

    protected override model(model: ModelBuilder): unknown {
        return this.modelOwner(model);
    }
}

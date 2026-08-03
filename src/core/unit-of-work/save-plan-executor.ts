import type { DatabaseConnection, DatabaseOperationOptions } from '../../storage/database-connection';
import type { StoreValueReader } from '../../storage/store-value-reader';
import type { SqlDialect } from '../../sql/sql-dialect';
import type { ChangeTracker } from '../../tracking/change-tracker';
import { DbUpdateConcurrencyError } from '../db-update-concurrency-error';
import type { SavePlanEntry } from '../save-plan';
import { savePlanExecution } from '../save-plan-execution';
import { GeneratedValueHydrator } from './generated-value-hydrator';
import { ModificationSqlBuilder } from '../../sql/modification-sql-builder';
import type { GeneratedValueAcceptance } from './applied-generated-value';

export class SavePlanExecutor {
    private generatedValues?: GeneratedValueHydrator;

    constructor(
        private readonly getDatabase: () => DatabaseConnection,
        private readonly getDialect: () => SqlDialect,
        private readonly getValueReader: () => StoreValueReader | undefined,
        private readonly changeTracker: ChangeTracker,
    ) {}

    private get database(): DatabaseConnection {
        return this.getDatabase();
    }

    public async run(
        plan: readonly SavePlanEntry[],
        beforeCommit: () => void,
        options?: DatabaseOperationOptions,
    ): Promise<number> {
        this.generatedValues = new GeneratedValueHydrator(
            this.database,
            this.getDialect(),
            this.changeTracker,
            this.getValueReader(),
        );
        let affectedEntities = 0;
        const runPlan = async (): Promise<void> => {
            for (const entry of plan) {
                const execution = savePlanExecution(entry);
                const persisted = execution?.persistedEntries?.find(
                    snapshot => snapshot.entry.entity === entry.entity,
                );
                if (execution?.generatedKeyPropagations) {
                    if (!persisted) {
                        throw new Error(
                            `Dependent insert '${entry.entityName}' has no persisted-value snapshot.`,
                        );
                    }
                    this.generatedValues?.propagateGeneratedKeys(
                        entry,
                        persisted.values,
                        execution.generatedKeyPropagations,
                    );
                }
                const statement =
                    execution?.generatedKeyPropagations && execution.metadata
                        ? new ModificationSqlBuilder(this.getDialect())
                            .buildInsertFromValues(
                                execution.metadata,
                                persisted?.values ?? {},
                            )
                        : execution?.buildStatement?.(
                            (entity, propertyName) =>
                                this.generatedValues?.findPersistedValue(
                                    entity,
                                    propertyName,
                                ),
                        ) ?? entry.statement;
                const result = await this.database.query(statement, options);
                if (!entry.skipAffectedRowsCheck) {
                    ensureAffectedRows(
                        entry,
                        result.rowCount,
                        this.changeTracker,
                    );
                }
                await this.generatedValues?.hydrate(
                    entry,
                    result,
                    execution?.generatedValues,
                    options,
                );
                if (!entry.isSystemGenerated) {
                    affectedEntities += entry.affectedEntityCount ?? 1;
                }
            }
        };

        const releaseSaveLock = this.changeTracker.beginSaveExecution();
        try {
            await this.database.transaction(async () => {
                await runPlan();
                beforeCommit();
            }, options);
        } finally {
            releaseSaveLock();
        }

        return affectedEntities;
    }

    public acceptGeneratedValues(): GeneratedValueAcceptance {
        const acceptance = this.generatedValues?.accept() ?? {
            values: [],
            rollback: () => undefined,
        };
        this.generatedValues = undefined;
        return acceptance;
    }

    public restoreGeneratedValues(): void {
        this.generatedValues?.restore();
        this.generatedValues = undefined;
    }
}

function ensureAffectedRows(
    entry: SavePlanEntry,
    rowCount: number,
    changeTracker: ChangeTracker,
): void {
    if (rowCount !== (entry.expectedAffectedRows ?? 1)) {
        throw new DbUpdateConcurrencyError(
            entry.entityName,
            entry.keyValue,
            entry.state,
            rowCount,
            changeTracker.entry(entry.entity),
        );
    }
}

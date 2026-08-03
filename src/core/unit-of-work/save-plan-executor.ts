import type { DatabaseConnection, DatabaseOperationOptions } from '../../storage/database-connection';
import type { StoreValueReader } from '../../storage/store-value-reader';
import type { SqlDialect } from '../../sql/sql-dialect';
import type { ChangeTracker } from '../../tracking/change-tracker';
import { DbUpdateConcurrencyError } from '../db-update-concurrency-error';
import type { SavePlanEntry } from '../save-plan';
import { savePlanExecution } from '../save-plan-execution';
import { GeneratedValueHydrator } from './generated-value-hydrator';
import { ModificationSqlBuilder } from '../../sql/modification-sql-builder';

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
        options?: DatabaseOperationOptions,
    ): Promise<number> {
        this.generatedValues = new GeneratedValueHydrator(
            this.database,
            this.getDialect(),
            this.changeTracker,
            this.getValueReader(),
        );
        this.generatedValues.reset();
        let affectedEntities = 0;
        const runPlan = async (): Promise<void> => {
            for (const entry of plan) {
                const execution = savePlanExecution(entry);
                this.generatedValues?.propagateGeneratedKeys(
                    entry,
                    execution?.generatedKeyPropagations,
                );
                const statement =
                    execution?.generatedKeyPropagations && execution.metadata
                        ? new ModificationSqlBuilder(this.getDialect())
                            .buildInsert(execution.metadata, entry.entity)
                        : entry.statement;
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

        if (
            plan.length === 1
            && !this.database.isInTransaction
            && expectsAtMostOneRow(plan[0])
            && savePlanExecution(plan[0])?.generatedValues === undefined
            && options?.signal === undefined
        ) {
            await runPlan();
        } else {
            await this.database.transaction(runPlan, options);
        }

        return affectedEntities;
    }

    public acceptGeneratedValues(): () => void {
        const rollback = this.generatedValues?.accept() ?? (() => undefined);
        this.generatedValues = undefined;
        return rollback;
    }

    public restoreGeneratedValues(): void {
        this.generatedValues?.restore();
        this.generatedValues = undefined;
    }
}

function expectsAtMostOneRow(entry: SavePlanEntry): boolean {
    return (entry.expectedAffectedRows ?? 1) === 1
    && (entry.affectedEntityCount ?? 1) === 1;
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

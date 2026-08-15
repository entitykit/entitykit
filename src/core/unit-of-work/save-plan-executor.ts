import type { DatabaseConnection, DatabaseOperationOptions } from '../../storage/database-connection';
import type { StoreValueReader } from '../../storage/store-value-reader';
import type { SqlDialect } from '../../sql/sql-dialect';
import type { ChangeTracker } from '../../tracking/change-tracker';
import { DbUpdateConcurrencyError } from '../db-update-concurrency-error';
import type { SavePlanEntry } from '../save-plan';
import { publicEntityEntry } from '../../tracking/public-entity-entry';
import type { EntityNavigationLoader } from '../../tracking/navigation-entry';
import { savePlanExecution } from '../save-plan-execution';
import { GeneratedValueHydrator } from './generated-value-hydrator';
import { ModificationSqlBuilder } from '../../sql/modification-sql-builder';
import type { GeneratedValueAcceptance } from './applied-generated-value';
import { reconcileSavePlanChanges } from './save-plan-reconciliation';
import type { RestorationScope } from '../../restoration-scope';
export class SavePlanExecutor {
    private generatedValues?: GeneratedValueHydrator;
    constructor(
        private readonly getDatabase: () => DatabaseConnection,
        private readonly getDialect: () => SqlDialect,
        private readonly getValueReader: () => StoreValueReader | undefined,
        private readonly changeTracker: ChangeTracker,
        private readonly navigationLoader: EntityNavigationLoader,
    ) {}
    private get database(): DatabaseConnection {
        return this.getDatabase();
    }
    public async run(
        plan: readonly SavePlanEntry[],
        beforeCommit: () => void,
        scope: RestorationScope,
        options?: DatabaseOperationOptions,
    ): Promise<number> {
        this.generatedValues = new GeneratedValueHydrator(
            this.database,
            this.getDialect(),
            this.changeTracker,
            scope,
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
                        persisted.boundValues,
                        execution.generatedKeyPropagations,
                    );
                }
                const statement =
                    execution?.generatedKeyPropagations && execution.metadata
                        ? new ModificationSqlBuilder(this.getDialect())
                            .buildInsertFromValues(
                                execution.metadata,
                                persisted?.values ?? {},
                                [],
                                persisted?.boundValues,
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
                        this.navigationLoader,
                    );
                }
                await this.generatedValues?.hydrate(
                    entry,
                    result,
                    execution?.generatedValues,
                    persisted?.values,
                    persisted?.boundValues,
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
            reconcileSavePlanChanges(plan, this.changeTracker);
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
        const generated = this.generatedValues;
        this.generatedValues = undefined;
        generated?.restore();
    }
}
function ensureAffectedRows(
    entry: SavePlanEntry, rowCount: number,
    changeTracker: ChangeTracker,
    navigationLoader: EntityNavigationLoader,
): void {
    if (rowCount !== (entry.expectedAffectedRows ?? 1)) {
        throw new DbUpdateConcurrencyError(
            entry.entityName,
            entry.keyValue,
            entry.state,
            rowCount,
            publicConcurrencyEntry(
                changeTracker,
                navigationLoader,
                entry.entity,
            ),
        );
    }
}
function publicConcurrencyEntry(
    changeTracker: ChangeTracker, navigationLoader: EntityNavigationLoader,
    entity: object,
): ReturnType<typeof publicEntityEntry> | undefined {
    const entry = changeTracker.entry(entity);
    return entry ? publicEntityEntry(entry, navigationLoader) : undefined;
}

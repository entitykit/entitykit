import { ModelBuilder } from '../../packages/core/src/model/model-builder';
import type { ModelSnapshot } from '../../packages/core/src/model/model-snapshot-types';
import { MigrationRunner, diffModelSnapshots } from '../../packages/core/src/migrations/api';
import { SqliteDatabaseConnection, sqliteProviderServices } from '../../packages/sqlite/src';

class PlanningRecord {
    public id = 0;
    public label = '';
    public note = '';
}

export interface PlanningOptions {
    readonly table?: string;
    readonly schema?: string;
    readonly keyed?: boolean;
    readonly generated?: boolean;
    readonly optionalLabel?: boolean;
    readonly note?: 'plain' | 'collated' | 'computed';
    readonly check?: boolean;
    readonly index?: boolean;
}

export function planningSnapshot(options: PlanningOptions = {}): ModelSnapshot {
    return new ModelBuilder().entity(PlanningRecord, entity => {
        entity.toTable(options.table ?? 'planning_records', options.schema);
        if (options.keyed === false) {
            entity.hasNoKey();
        } else {
            entity.hasKey(row => row.id);
            const id = entity.property(row => row.id).hasColumnType('integer').isRequired();
            if (options.generated) id.useSqliteRowId({ preventReuse: true });
        }
        const label = entity.property(row => row.label).hasColumnType('text');
        if (!options.optionalLabel) label.isRequired();
        if (options.note) {
            const note = entity.property(row => row.note).hasColumnType('text');
            if (options.note === 'computed') note.hasComputedColumnSql('lower(label)', true);
            else note.hasDefaultValue('memo');
            if (options.note === 'collated') note.useCollation('NOCASE');
        }
        if (options.check) entity.hasCheckConstraint('ck_planning_label', 'length(label) > 0');
        if (options.index) entity.hasIndex(row => row.label).hasDatabaseName('ix_planning_label');
    }).build().toSnapshot();
}

export async function planningRows(connection: SqliteDatabaseConnection, text: string): Promise<unknown> {
    return (await connection.query({ text, values: [] })).rows;
}

export async function qualifyPlanningPair(
    before: ModelSnapshot,
    after: ModelSnapshot,
    inspect: (connection: SqliteDatabaseConnection, direction: 'up' | 'down') => Promise<void>,
): Promise<void> {
    const connection = new SqliteDatabaseConnection(':memory:');
    const initial = diffModelSnapshots({ formatVersion: 1, entities: [] }, before)
        .toMigration('20261004000100_CreatePlanningRecord', 'CreatePlanningRecord');
    const changed = diffModelSnapshots(before, after)
        .toMigration('20261004000101_ChangePlanningRecord', 'ChangePlanningRecord');
    const runner = new MigrationRunner(connection, sqliteProviderServices.migrationDialect, sqliteProviderServices.createMigrationBuilder);
    try {
        await runner.update([initial]);
        await planningRows(connection, before.entities[0].keyProperty
            ? 'insert into planning_records (id, label) values (7, \'Novel\')'
            : 'insert into planning_records (label) values (\'Novel\')');
        await runner.update([initial, changed]);
        await inspect(connection, 'up');
        await runner.update([initial, changed], { target: initial.id });
        await inspect(connection, 'down');
        expect((await runner.getAppliedMigrations({ initializeHistory: false })).map(row => row.id)).toEqual([initial.id]);
        expect(await planningRows(connection, 'pragma foreign_keys')).toEqual([{ foreign_keys: 1 }]);
    } finally {
        await connection.dispose();
    }
}

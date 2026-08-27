import { join } from 'node:path';
import {
    DbContext,
    type EntityKitDataSource,
    type ModelBuilder,
} from '../packages/core/src';
import { EntityKitContextRunner } from '../packages/nestjs/src/entity-kit-context-runner';
import type { EntityKitContextType } from '../packages/nestjs/src/entity-kit-context-type';
import { createSqliteDataSource } from '../packages/sqlite/src';
import { createManagedTempDirectory } from './support/managed-temp-directory';

class RunnerRow {
    public id!: string;
    public label!: string;
}

class RunnerContext extends DbContext {
    public rows = this.set<RunnerRow, [id: string]>(RunnerRow);

    constructor(
        source: EntityKitDataSource,
        public readonly requestId: string,
    ) {
        super(source);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(RunnerRow, entity => {
            entity.toTable('runner_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired();
        });
    }
}

const runnerContextType: EntityKitContextType<
    RunnerContext,
    [requestId: string]
> = RunnerContext;

describe('EntityKitContextRunner', () => {
    it('forwards context arguments and disposes after successful work', async () => {
        const directory = createManagedTempDirectory('entitykit-nest-runner-');
        const source = createSqliteDataSource(join(directory, 'runner.db'));
        const runner: EntityKitContextRunner<RunnerContext, [requestId: string]> =
            new EntityKitContextRunner(
                source,
                runnerContextType,
            );

        await expect(runner.run(async context => {
            expect(context.requestId).toBe('request-1');
            await context.database.connection.query({
                text: 'create table runner_rows (id text primary key, label text not null)',
                values: [],
            });
            context.rows.add(Object.assign(new RunnerRow(), { id: 'one', label: 'First' }));
            return await context.saveChanges();
        }, 'request-1')).resolves.toBe(1);

        await expect(source.dispose()).resolves.toBeUndefined();
    });

    it('disposes its context when work throws', async () => {
        const directory = createManagedTempDirectory('entitykit-nest-runner-error-');
        const source = createSqliteDataSource(join(directory, 'runner.db'));
        const runner: EntityKitContextRunner<RunnerContext, [requestId: string]> =
            new EntityKitContextRunner(
                source,
                runnerContextType,
            );

        await expect(runner.run(() => {
            throw new Error('work failed');
        }, 'request-2')).rejects.toThrow('work failed');
        await expect(source.dispose()).resolves.toBeUndefined();
    });

    it('preserves work and disposal failures together', async () => {
        const workError = new Error('work failed');
        const disposalError = new Error('dispose failed');
        const dispose = jest.fn().mockRejectedValue(disposalError);
        const context = {
            dispose,
        } as unknown as DbContext;
        const contextType = {
            prototype: context,
            create: () => context,
        } as unknown as EntityKitContextType<DbContext, []>;
        const runner = new EntityKitContextRunner(
            {} as EntityKitDataSource,
            contextType,
        );

        const failure = runner.run(() => {
            throw workError;
        });

        await expect(failure).rejects.toMatchObject({
            cause: workError,
            errors: [workError, disposalError],
        });
        expect(dispose).toHaveBeenCalledTimes(1);
    });
});

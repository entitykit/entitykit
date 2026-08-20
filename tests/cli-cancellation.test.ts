import fs from 'node:fs';
import path from 'node:path';
import { runEntityKitCli } from '../packages/cli/src/api';
import { withOperationSignal } from '../packages/core/src/storage/with-operation-signal';
import { createProjectWithCustomProvider } from './migration-cli-files/migration-cli-files-test-support';
import { createManagedTempDirectory } from './support/managed-temp-directory';

describe('CLI cancellation', () => {
    it('returns the conventional cancellation code and stable error', async () => {
        const cancellation = new AbortController();
        cancellation.abort(new Error('test cancellation'));

        const result = await runEntityKitCli(
            ['db', 'status'],
            { cwd: createProjectWithCustomProvider(), signal: cancellation.signal },
        );

        expect(result).toMatchObject({
            command: 'db.status',
            outcome: 'error',
            exitCode: 130,
            error: { code: 'OPERATION_CANCELED' },
        });
    });

    it('cancels an in-flight db pull introspector', async () => {
        const cwd = createManagedTempDirectory('entitykit-cli-cancel-pull-');
        const startedPath = path.join(cwd, 'introspection.started');
        fs.writeFileSync(path.join(cwd, 'entitykit.config.ts'), `
          import fs from "node:fs";
          import { MigrationBuilder } from "@entitykit/core/migrations";
          class TestContext { static create() { return new TestContext(); } }
          const sql = {
            name: "cancel-sql",
            quoteIdentifier: (value: string) => '"' + value + '"',
            quoteQualifiedIdentifier: (...values: Array<string | undefined>) => values.filter(Boolean).join("."),
            parameter: (index: number) => "$" + index,
            countAllExpression: () => "count(*)",
            falsePredicate: () => "false",
            insertConflictDoNothingClause: () => "on conflict do nothing"
          };
          const provider = {
            name: "cancel-provider",
            dialect: sql,
            migrationDialect: {
              name: "cancel-migrations",
              sql,
              createMigrationHistoryTableStatement: () => ({ text: "create history", values: [] }),
              selectMigrationHistoryStatement: () => ({ text: "select history", values: [] }),
              insertMigrationHistoryStatement: () => ({ text: "insert history", values: [] }),
              deleteMigrationHistoryStatement: () => ({ text: "delete history", values: [] })
            },
            createMigrationBuilder: () => new MigrationBuilder(sql),
            createConnection: () => ({
              isInTransaction: false,
              query: async () => ({ rows: [], rowCount: 0 }),
              transaction: async (work: () => unknown) => work(),
              dispose: async () => {}
            }),
            createSchemaIntrospector: () => ({
              async introspect() {
                fs.writeFileSync(${JSON.stringify(startedPath)}, "started");
                return new Promise(() => {});
              }
            })
          };
          export default { context: TestContext, provider, connectionString: "fake://memory" };
        `);
        const cancellation = new AbortController();
        const running = runEntityKitCli(['db', 'pull', '--stdout'], {
            cwd,
            signal: cancellation.signal,
        });

        await waitForFile(startedPath);
        cancellation.abort(new Error('stop introspection'));
        const result = await within(running, 'db pull did not observe cancellation');

        expect(result).toMatchObject({
            command: 'db.pull',
            outcome: 'error',
            exitCode: 130,
            error: { code: 'OPERATION_CANCELED' },
        });
    });

    it('threads the command signal into introspection database queries', async () => {
        const cancellation = new AbortController();
        const query = jest.fn(async () => Promise.resolve({ rows: [], rowCount: 0 }));
        const connection = withOperationSignal({
            isInTransaction: false,
            query,
            async transaction(work) {
                return work();
            },
        }, cancellation.signal);

        await connection.query({ text: 'select schema', values: [] });

        expect(query).toHaveBeenCalledWith(
            { text: 'select schema', values: [] },
            { signal: cancellation.signal },
        );
    });
});

async function within<TResult>(promise: Promise<TResult>, message: string): Promise<TResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout: Promise<TResult> = new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
            reject(new Error(message));
        }, 1000);
    });
    try {
        return await Promise.race([promise, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

async function waitForFile(filePath: string): Promise<void> {
    const deadline = Date.now() + 1000;
    while (!fs.existsSync(filePath)) {
        if (Date.now() >= deadline) {
            throw new Error('db pull introspection did not start');
        }
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}

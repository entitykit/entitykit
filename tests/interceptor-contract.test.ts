import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, type SaveChangesInterceptor } from '../src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

/**
 * What an interceptor is allowed to do, and what it is handed.
 *
 * The existing tests covered the three hooks firing and failing. These cover
 * the contract around them: ordering, multiplicity, and — the one that was
 * wrong — whether the save plan an interceptor receives is really read-only.
 */
class Row {
    public id!: string;
    public label!: string;

    constructor(data?: Partial<Row>) {
        Object.assign(this, data);
    }
}

let connection: RecordingDatabaseConnection;
let registered: SaveChangesInterceptor[] = [];

class InterceptedDbContext extends DbContext {
    public rows = this.set(Row);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(connection);
        for (const interceptor of registered) {
            options.useSaveInterceptor(interceptor);
        }
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Row, entity => {
            entity.toTable('rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(row => row.label).hasColumnName('label').hasColumnType('text').isRequired();
        });
    }
}

function open(interceptors: SaveChangesInterceptor[]): InterceptedDbContext {
    connection = new RecordingDatabaseConnection();
    registered = interceptors;
    const db =  InterceptedDbContext.create();
    connection.queueResult({ rows: [], rowCount: 1 });
    return db;
}

describe('interceptor contract', () => {
    describe('the save plan is read-only in fact, not only in type', () => {
        it('refuses an attempt to rewrite the SQL that will run', async () => {
            // The type said `readonly SavePlanEntry[]` and the docs say interceptors
            // *observe* the plan. Neither was enforced: assigning to
            // `entry.statement.text` silently changed what executed.
            let rejected = '';
            const db =  open([{
                savingChanges: event => {
                    try {
                        (event.plan[0] as unknown as { statement: { text: string } }).statement.text = 'update rows set label = \'HIJACKED\'';
                    } catch (error) {
                        rejected = (error as Error).message;
                    }
                },
            }]);
            db.rows.add(new Row({ id: '1', label: 'x' }));

            await db.saveChanges();

            expect(rejected).toMatch(/Cannot assign to read only property 'text'/);
            expect(connection.statements[0]?.text).toContain('insert into "rows"');
            await db.dispose();
        });

        it('refuses an attempt to add an entry to the plan', async () => {
            // A pushed entry used to be executed, and surfaced as
            // "Concurrency conflict while saving 'undefined' with key 'undefined'".
            let rejected = '';
            const db =  open([{
                savingChanges: event => {
                    try {
                        (event.plan as unknown as unknown[]).push({ bogus: true });
                    } catch (error) {
                        rejected = (error as Error).message;
                    }
                },
            }]);
            db.rows.add(new Row({ id: '1', label: 'x' }));

            await db.saveChanges();

            expect(rejected).toMatch(/not extensible/);
            expect(connection.statements).toHaveLength(1);
            await db.dispose();
        });

        it('refuses an attempt to change a bound parameter', async () => {
            let rejected = '';
            const db =  open([{
                savingChanges: event => {
                    try {
                        (event.plan[0].statement.values as unknown[])[1] = 'tampered';
                    } catch (error) {
                        rejected = (error as Error).message;
                    }
                },
            }]);
            db.rows.add(new Row({ id: '1', label: 'x' }));

            await db.saveChanges();

            expect(rejected).toMatch(/read only|not extensible/);
            expect(connection.statements[0]?.values).toContain('x');
            await db.dispose();
        });
    });

    describe('ordering and multiplicity', () => {
        it('runs every before hook, then every after hook, in registration order', async () => {
            const order: string[] = [];
            const make = (name: string): SaveChangesInterceptor => ({
                savingChanges: () => {
                    order.push(`before:${name}`);
                },
                savedChanges: () => {
                    order.push(`after:${name}`);
                },
            });
            const db =  open([make('a'), make('b'), make('c')]);
            db.rows.add(new Row({ id: '1', label: 'x' }));

            await db.saveChanges();

            expect(order).toEqual(['before:a', 'before:b', 'before:c', 'after:a', 'after:b', 'after:c']);
            await db.dispose();
        });

        it('calls an interceptor once per registration', async () => {
            // Registering the same object twice runs it twice, the way an event
            // listener would. Pinned so it is a decision rather than a surprise.
            let calls = 0;
            const once: SaveChangesInterceptor = { savingChanges: () => {
                calls += 1;
            } };
            const db =  open([once, once]);
            db.rows.add(new Row({ id: '1', label: 'x' }));

            await db.saveChanges();

            expect(calls).toBe(2);
            await db.dispose();
        });

        it('stops at the first before hook that throws, and issues no SQL', async () => {
            const ran: string[] = [];
            const db =  open([
                { savingChanges: () => {
                    ran.push('first');
                } },
                { savingChanges: () => {
                    ran.push('second'); throw new Error('hook failed');
                } },
                { savingChanges: () => {
                    ran.push('third');
                } },
            ]);
            db.rows.add(new Row({ id: '1', label: 'x' }));

            await expect(db.saveChanges()).rejects.toThrow('hook failed');

            // Fail fast: the third never runs, and nothing reaches the database.
            expect(ran).toEqual(['first', 'second']);
            expect(connection.statements).toHaveLength(0);
            await db.dispose();
        });

        it('awaits an async before hook before issuing any SQL', async () => {
            const order: string[] = [];
            const db =  open([{
                savingChanges: async () => {
                    order.push('hook start');
                    await new Promise(resolve => setTimeout(resolve, 10));
                    order.push('hook end');
                },
            }]);
            const inner = connection.query.bind(connection);
            (connection as unknown as { query: unknown }).query = async (statement: never) => {
                order.push('statement');
                return inner(statement);
            };
            db.rows.add(new Row({ id: '1', label: 'x' }));

            await db.saveChanges();

            expect(order).toEqual(['hook start', 'hook end', 'statement']);
            await db.dispose();
        });
    });

    it('has already committed and accepted changes when an after hook throws', async () => {
    // The save succeeded; only the notification failed. The error surfaces,
    // but the write is not undone and the entity is no longer dirty.
        const db =  open([{ savedChanges: () => {
            throw new Error('after-save failed');
        } }]);
        const row = new Row({ id: '1', label: 'x' });
        db.rows.add(row);

        await expect(db.saveChanges()).rejects.toThrow('after-save failed');

        expect(connection.statements).toHaveLength(1);
        expect(db.entry(row)?.state).toBe('Unchanged');
        await db.dispose();
    });
});

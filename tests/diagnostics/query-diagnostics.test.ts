import { type QueryPlanDiagnosticEvent } from '../../packages/core/src';
import {
    DiagnosticsContext,
    resetDiagnosticsContext,
} from './diagnostics-test-support';
import {
    anyNumber,
    containing,
} from '../support/jest-asymmetric-matchers';

describe('query diagnostics', () => {
    beforeEach(resetDiagnosticsContext);

    it('emits query diagnostics with row count and provider details', async () => {
        const db =  DiagnosticsContext.create();
        DiagnosticsContext.connection.queueResult({ rows: [{ id: 'usr_1' }], rowCount: 1 });

        await db.database.connection.query({ text: 'select * from users where id = $1', values: ['usr_1'] });

        expect(DiagnosticsContext.events).toEqual([
            containing({
                kind: 'query',
                provider: 'diagnostic-test',
                statement: { text: 'select * from users where id = $1', values: ['usr_1'] },
                rowCount: 1,
                durationMs: anyNumber(),
            }),
        ]);
    });

    it('emits failed query diagnostics and preserves the provider error', async () => {
        const db =  DiagnosticsContext.create();
        const failure = new Error('database failed');
        DiagnosticsContext.connection.queueError(failure);

        await expect(db.database.connection.query({ text: 'select broken', values: [] })).rejects.toBe(failure);

        expect(DiagnosticsContext.events).toEqual([
            containing({
                kind: 'query',
                provider: 'diagnostic-test',
                statement: { text: 'select broken', values: [] },
                error: failure,
                durationMs: anyNumber(),
            }),
        ]);
    });

    it('does not let a diagnostic handler change a successful query result', async () => {
        const db = DiagnosticsContext.create();
        DiagnosticsContext.connection.queueResult({
            rows: [{ id: 'usr_1' }],
            rowCount: 1,
        });
        DiagnosticsContext.handler = () => {
            throw new Error('telemetry failed');
        };

        await expect(db.database.connection.query({
            text: 'select * from users',
            values: [],
        })).resolves.toMatchObject({ rowCount: 1 });
    });

    it('emits query plan diagnostics without parameter values', async () => {
        const db =  DiagnosticsContext.create();
        DiagnosticsContext.connection.queueResult({ rows: [{ id: 'usr_secret' }], rowCount: 1 });

        await db.users
            .where(user => user.id.eq('usr_secret'))
            .orderBy(user => user.id)
            .take(5)
            .toArray();

        const planEvents = DiagnosticsContext.events.filter(
            (event): event is QueryPlanDiagnosticEvent => event.kind === 'queryPlan',
        );

        expect(planEvents).toEqual([
            containing({
                kind: 'queryPlan',
                provider: 'diagnostic-test',
                phase: 'compile',
                sqlText: 'select "id" from "users" where "id" = $1 order by "id" asc limit $2',
                durationMs: anyNumber(),
                shape: {
                    entityName: 'User',
                    operation: 'toArray',
                    hasPredicate: true,
                    joinCount: 0,
                    joinKinds: [],
                    orderingCount: 1,
                    includeCount: 0,
                    projectionCount: 0,
                    hasOffset: false,
                    hasLimit: true,
                    ignoresQueryFilters: false,
                    ignoresTenantScope: false,
                },
            }),
            containing({
                kind: 'queryPlan',
                provider: 'diagnostic-test',
                phase: 'execute',
                rowCount: 1,
                resultCount: 1,
                durationMs: anyNumber(),
                shape: containing({ entityName: 'User', operation: 'toArray' }),
            }),
        ]);
        expect(JSON.stringify(planEvents)).not.toContain('usr_secret');
    });

    it('emits aggregate query plan diagnostics for grouped reports', async () => {
        const db =  DiagnosticsContext.create();
        DiagnosticsContext.connection.queueResult({
            rows: [{ id: 'usr_1', userCount: '2' }],
            rowCount: 1,
        });

        await db.users
            .groupBy(user => ({ id: user.id }))
            .having(group => group.count().gte(2))
            .orderByDescending(group => group.count())
            .take(3)
            .select(group => ({
                id: group.key.id,
                userCount: group.count(),
            }))
            .toArray();

        const planEvents = DiagnosticsContext.events.filter(
            (event): event is QueryPlanDiagnosticEvent => event.kind === 'queryPlan',
        );

        expect(planEvents).toEqual([
            containing({
                kind: 'queryPlan',
                provider: 'diagnostic-test',
                phase: 'compile',
                sqlText: 'select "id" as "id", count(*)::int as "userCount" from "users" group by "id" having count(*)::int >= $1 order by count(*)::int desc limit $2',
                durationMs: anyNumber(),
                shape: {
                    entityName: 'User',
                    operation: 'aggregate',
                    hasPredicate: false,
                    joinCount: 0,
                    joinKinds: [],
                    orderingCount: 0,
                    includeCount: 0,
                    projectionCount: 0,
                    aggregateCount: 1,
                    groupKeyCount: 1,
                    hasHaving: true,
                    aggregateOrderingCount: 1,
                    hasOffset: false,
                    hasLimit: true,
                    ignoresQueryFilters: false,
                    ignoresTenantScope: false,
                },
            }),
            containing({
                kind: 'queryPlan',
                provider: 'diagnostic-test',
                phase: 'execute',
                rowCount: 1,
                resultCount: 1,
                durationMs: anyNumber(),
                shape: containing({
                    entityName: 'User',
                    operation: 'aggregate',
                    aggregateCount: 1,
                    groupKeyCount: 1,
                    hasHaving: true,
                    aggregateOrderingCount: 1,
                }),
            }),
        ]);
        expect(JSON.stringify(planEvents)).not.toContain('[2,3]');
    });

    it('emits relation existence query plan diagnostics without parameter values', async () => {
        const db =  DiagnosticsContext.create();
        DiagnosticsContext.connection.queueResult({ rows: [], rowCount: 0 });

        await db.users
            .whereHas(user => user.posts, post => post.id.eq('post_secret'))
            .whereDoesNotHave(user => user.posts)
            .toArray();

        const planEvents = DiagnosticsContext.events.filter(
            (event): event is QueryPlanDiagnosticEvent => event.kind === 'queryPlan',
        );

        expect(planEvents).toEqual([
            containing({
                kind: 'queryPlan',
                provider: 'diagnostic-test',
                phase: 'compile',
                sqlText: 'select "root"."id" from "users" "root" where exists(select 1 from "posts" "rel" where "rel"."author_id" = "root"."id" and "rel"."id" = $1) and not exists(select 1 from "posts" "rel" where "rel"."author_id" = "root"."id")',
                durationMs: anyNumber(),
                shape: {
                    entityName: 'User',
                    operation: 'toArray',
                    hasPredicate: false,
                    joinCount: 0,
                    joinKinds: [],
                    relationExistenceCount: 2,
                    hasAntiRelationExistence: true,
                    hasManyToManyRelationExistence: false,
                    orderingCount: 0,
                    includeCount: 0,
                    projectionCount: 0,
                    hasOffset: false,
                    hasLimit: false,
                    ignoresQueryFilters: false,
                    ignoresTenantScope: false,
                },
            }),
            containing({
                kind: 'queryPlan',
                provider: 'diagnostic-test',
                phase: 'execute',
                rowCount: 0,
                resultCount: 0,
                durationMs: anyNumber(),
                shape: containing({
                    entityName: 'User',
                    operation: 'toArray',
                    relationExistenceCount: 2,
                    hasAntiRelationExistence: true,
                }),
            }),
        ]);
        expect(JSON.stringify(planEvents)).not.toContain('post_secret');
    });
});

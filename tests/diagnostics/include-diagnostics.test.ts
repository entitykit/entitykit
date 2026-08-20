import { type IncludeDiagnosticEvent } from '../../packages/core/src';
import {
    DiagnosticsContext,
    fallbackDialect,
    resetDiagnosticsContext,
} from './diagnostics-test-support';
import {
    anyNumber,
    containing,
} from '../support/jest-asymmetric-matchers';

describe('include diagnostics', () => {
    beforeEach(resetDiagnosticsContext);

    it('emits include diagnostics for split-query loading', async () => {
        const db =  DiagnosticsContext.create();
        DiagnosticsContext.connection.queueResult({ rows: [{ id: 'usr_1' }], rowCount: 1 });
        DiagnosticsContext.connection.queueResult({
            rows: [{ id: 'post_1', author_id: 'usr_1' }],
            rowCount: 1,
        });

        await db.users.include(user => user.posts).toArray();

        const includeEvents = DiagnosticsContext.events.filter(
            (event): event is IncludeDiagnosticEvent => event.kind === 'include',
        );

        expect(includeEvents).toEqual([
            containing({
                kind: 'include',
                provider: 'diagnostic-test',
                parentEntityName: 'User',
                relatedEntityName: 'Post',
                navigationProperty: 'posts',
                strategy: 'splitQuery',
                parentCount: 1,
                keyCount: 1,
                rowCount: 1,
                loadedCount: 1,
                durationMs: anyNumber(),
            }),
        ]);
    });

    it('emits include diagnostics for per-parent fallback loading', async () => {
        DiagnosticsContext.dialect = fallbackDialect;
        const db =  DiagnosticsContext.create();
        DiagnosticsContext.connection.queueResult({ rows: [{ id: 'usr_1' }], rowCount: 1 });
        DiagnosticsContext.connection.queueResult({
            rows: [{ id: 'post_1', author_id: 'usr_1' }],
            rowCount: 1,
        });

        await db.users
            .include(user => user.posts.orderBy(post => post.id).take(1))
            .toArray();

        const includeEvents = DiagnosticsContext.events.filter(
            (event): event is IncludeDiagnosticEvent => event.kind === 'include',
        );

        expect(includeEvents).toEqual([
            containing({
                kind: 'include',
                provider: 'diagnostic-test',
                parentEntityName: 'User',
                relatedEntityName: 'Post',
                navigationProperty: 'posts',
                strategy: 'perParentFallback',
                parentCount: 1,
                keyCount: 1,
                rowCount: 1,
                loadedCount: 1,
                durationMs: anyNumber(),
            }),
        ]);
        expect(DiagnosticsContext.connection.statements[1]).toEqual({
            text: 'select [id], [author_id] from [posts] where [author_id] in (?) order by [id] asc limit ?',
            values: ['usr_1', 1],
        });
    });

    it('emits diagnostics for the final repeated include filter', async () => {
        DiagnosticsContext.dialect = fallbackDialect;
        const db =  DiagnosticsContext.create();
        DiagnosticsContext.connection.queueResult({ rows: [{ id: 'usr_1' }], rowCount: 1 });
        DiagnosticsContext.connection.queueResult({
            rows: [{ id: 'post_2', author_id: 'usr_1' }],
            rowCount: 1,
        });

        await db.users
            .include(user => user.posts.orderBy(post => post.id).take(1))
            .include(user => user.posts.orderByDescending(post => post.id).take(2))
            .toArray();

        const includeEvents = DiagnosticsContext.events.filter(
            (event): event is IncludeDiagnosticEvent => event.kind === 'include',
        );

        expect(includeEvents).toHaveLength(1);
        expect(includeEvents[0]).toEqual(containing({
            kind: 'include',
            strategy: 'perParentFallback',
            navigationProperty: 'posts',
            parentCount: 1,
            keyCount: 1,
            rowCount: 1,
            loadedCount: 1,
        }));
        expect(DiagnosticsContext.connection.statements[1]).toEqual({
            text: 'select [id], [author_id] from [posts] where [author_id] in (?) order by [id] desc limit ?',
            values: ['usr_1', 2],
        });
    });
});

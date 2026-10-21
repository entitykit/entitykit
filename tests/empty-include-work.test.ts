import { ContextDisposedError } from '../packages/core/src';
import * as navigationLoads from '../packages/core/src/tracking/navigation-load-operation';
import {
    DiagnosticsContext,
    resetDiagnosticsContext,
} from './diagnostics/diagnostics-test-support';

describe('empty eager-load work', () => {
    beforeEach(resetDiagnosticsContext);
    afterEach(() => jest.restoreAllMocks());

    it.each([false, true])('avoids navigation journals with no includes (no tracking: %s)', async noTracking => {
        const db = DiagnosticsContext.create();
        try {
            DiagnosticsContext.connection.queueResult({
                rows: [{ id: 'u1' }, { id: 'u1' }], rowCount: 2,
            });
            const loads = jest.spyOn(navigationLoads, 'runNavigationLoadOperation');
            const query = noTracking ? db.users.asNoTracking() : db.users;
            const rows = await query.toArray();
            expect(rows).toHaveLength(2);
            expect(rows[0]).toBe(rows[1]);
            expect(rows[0].id).toBe('u1');
            expect(db.changeTracker.entries()).toHaveLength(noTracking ? 0 : 1);
            expect(loads).not.toHaveBeenCalled();
            expect(DiagnosticsContext.connection.statements).toHaveLength(1);
            expect(DiagnosticsContext.events.filter(event => event.kind === 'queryPlan')
                .map(event => event.phase)).toEqual(['compile', 'execute']);
        } finally {
            await db.dispose();
        }
    });

    it.each([false, true])('avoids navigation journals with no roots (no tracking: %s)', async noTracking => {
        const db = DiagnosticsContext.create();
        try {
            DiagnosticsContext.connection.queueResult({ rows: [], rowCount: 0 });
            const loads = jest.spyOn(navigationLoads, 'runNavigationLoadOperation');
            const query = noTracking ? db.users.asNoTracking() : db.users;
            await expect(query.include(user => user.posts).toArray()).resolves.toEqual([]);
            expect(loads).not.toHaveBeenCalled();
            expect(DiagnosticsContext.connection.statements).toHaveLength(1);
            expect(db.changeTracker.entries()).toEqual([]);
            expect(DiagnosticsContext.events.filter(event => event.kind === 'include')).toEqual([]);
        } finally {
            await db.dispose();
        }
    });

    it.each([false, true])('keeps the graph journal for a populated include (no tracking: %s)', async noTracking => {
        const db = DiagnosticsContext.create();
        try {
            DiagnosticsContext.connection.queueResult({ rows: [{ id: 'u1' }], rowCount: 1 });
            DiagnosticsContext.connection.queueResult({ rows: [{ id: 'p1', author_id: 'u1' }], rowCount: 1 });
            const loads = jest.spyOn(navigationLoads, 'runNavigationLoadOperation');
            const query = noTracking ? db.users.asNoTracking() : db.users;
            const rows = await query.include(user => user.posts).toArray();
            expect(rows[0].posts).toHaveLength(1);
            expect(rows[0].posts[0].author).toBe(rows[0]);
            expect(db.changeTracker.entries()).toHaveLength(noTracking ? 0 : 2);
            expect(loads).toHaveBeenCalledTimes(1);
            expect(DiagnosticsContext.connection.statements).toHaveLength(2);
            expect(DiagnosticsContext.events.filter(event => event.kind === 'include')).toHaveLength(1);
        } finally {
            await db.dispose();
        }
    });

    it.each([false, true])('keeps the post-query disposal check (empty roots: %s)', async empty => {
        const db = DiagnosticsContext.create();
        let disposal: Promise<void> | undefined;
        DiagnosticsContext.connection.queueResult({ rows: empty ? [] : [{ id: 'u1' }], rowCount: empty ? 0 : 1 });
        DiagnosticsContext.handler = event => {
            DiagnosticsContext.events.push(event);
            if (event.kind === 'queryPlan' && event.phase === 'execute' && !disposal) {
                disposal = db.dispose();
            }
        };
        try {
            await expect(db.users.asNoTracking().toArray()).rejects.toBeInstanceOf(ContextDisposedError);
            expect(disposal).toBeDefined();
            await disposal;
        } finally {
            await db.dispose();
        }
    });
});

import { openBufferedIdentityGraph } from './support/buffered-identity-sqlite';
import { materializedPersistenceFacts } from '../packages/core/src/materialization/materialized-bound-values';
import * as bufferedIdentities from '../packages/core/src/materialization/buffered-query-identities';
import type { QueryIdentityResolution } from '../packages/core/src/materialization/query-identity-resolution';

describe('buffered compiled identity execution against SQLite', () => {
    afterEach(() => jest.restoreAllMocks());

    it.each([false, true])('shares the include scope, unwinds failure and keeps attach/save facts, compiled=%p', async compiled => {
        const fixture = await openBufferedIdentityGraph(compiled);
        const scopes: QueryIdentityResolution[] = [];
        const create = bufferedIdentities.createBufferedQueryIdentities;
        jest.spyOn(bufferedIdentities, 'createBufferedQueryIdentities').mockImplementation(model => {
            const scope = create(model);scopes.push(scope);return scope;
        });
        const capture = jest.spyOn(bufferedIdentities.BufferedQueryIdentities.prototype, 'capture');
        const check = (parents: Awaited<ReturnType<typeof fixture.read>>): void => {
            expect(parents).toHaveLength(3);
            for (const parent of parents) {
                expect(parent.name).toBe(`parent${String(parent.id)}`);expect(parent.children).toHaveLength(2);
                for (const child of parent.children) {
                    expect(child.parent).toBe(parent);expect(child.parentId).toBe(parent.id);
                    expect(child.name).toBe(`child${String(child.id)}`);
                }
                expect(materializedPersistenceFacts(parent)).toEqual({ values: { id: parent.id, name: parent.name }, boundValues: { id: parent.id, name: parent.name } });
            }
            expect(fixture.db.changeTracker.entries()).toEqual([]);
        };
        try {
            const first = await fixture.read();check(first);
            const second = await fixture.read();check(second);expect(second[0]).not.toBe(first[0]);
            fixture.createdParents.length = 0;fixture.setRefuse(true);
            await expect(fixture.read()).rejects.toThrow('refused include parent');fixture.setRefuse(false);
            expect(fixture.createdParents.length).toBeGreaterThanOrEqual(3);
            expect(fixture.createdParents.every(parent => parent.children.length === 0)).toBe(true);check(first);
            check(await fixture.read());expect(scopes).toHaveLength(4);
            if (compiled) {
                expect(new Set(capture.mock.calls.map(call => call[0].entityName))).toEqual(new Set(['Parent', 'Child']));
                for (const scope of scopes) for (const metadata of fixture.metadata) {
                    expect(scope.get(metadata, { get id(): never {
                        throw new Error('scope retained a table');
                    } })).toBeUndefined();
                }
            } else expect(capture).not.toHaveBeenCalled();
            fixture.db.parents.attach(second[0]);second[0].name = 'saved';
            expect(await fixture.db.saveChanges()).toBe(1);
            expect((await fixture.query('select name from receipt_parents where id=1')).rows[0].name).toBe('saved');
        } finally {
            await fixture.dispose();
        }
    });
});

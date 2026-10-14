import { QueryIdentityResolution } from '../packages/core/src/materialization/query-identity-resolution';
import { ModelBuilder } from '../packages/core/src/model/model-builder';
import type { EntityMetadata } from '../packages/core/src/model/entity-metadata';

class ScopeRow {
    public id = 1;
}

function metadata(): EntityMetadata<ScopeRow> {
    return new ModelBuilder().entity(ScopeRow, entity => {
        entity.toTable('scope_rows');
        entity.hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('integer').isRequired();
    }).build().getEntity(ScopeRow);
}

describe('query identity table lifetime', () => {
    it('isolates metadata identities and clears every table before reuse in a different order', () => {
        const identities = new QueryIdentityResolution();
        const models = [metadata(), metadata(), metadata()];
        const entities = models.map(() => new ScopeRow());
        for (let i = 0; i < models.length; i++) {
            identities.add(models[i], { id: 1 }, entities[i]);
        }
        for (let i = 0; i < models.length; i++) {
            expect(identities.get(models[i], { id: 1 })).toBe(entities[i]);
            expect(() => {
                identities.add(models[i], { id: 1 }, new ScopeRow());
            })
                .toThrow('Query identity collision');
            expect(identities.get(models[i], { id: 1 })).toBe(entities[i]);
        }
        identities.clear();
        const unreadable = {
            get id(): never {
                throw new Error('Unexpected key read');
            },
        };
        for (const model of models) expect(identities.get(model, unreadable)).toBeUndefined();
        for (const model of [...models].reverse()) {
            const replacement = new ScopeRow();
            identities.add(model, { id: 1 }, replacement);
            expect(identities.get(model, { id: 1 })).toBe(replacement);
        }
        identities.clear();
        for (const model of models) expect(identities.get(model, unreadable)).toBeUndefined();
    });

    it.each([false, true])('keeps a lookup receipt while its key getter clears the scope, secondary=%p', secondary => {
        const identities = new QueryIdentityResolution();
        if (secondary) identities.add(metadata(), { id: 1 }, new ScopeRow());
        const model = metadata();
        const original = new ScopeRow();
        identities.add(model, { id: 1 }, original);
        const bound = {
            get id(): number {
                identities.clear();
                return 1;
            },
        };

        expect(identities.get(model, bound)).toBe(original);
        expect(identities.get(model, { id: 1 })).toBeUndefined();
        const replacement = new ScopeRow();
        identities.add(model, { id: 1 }, replacement);
        expect(identities.get(model, { id: 1 })).toBe(replacement);
    });

    it.each([false, true])('publishes a table before key evaluation without restoring it after reentrant clear, secondary=%p', secondary => {
        const identities = new QueryIdentityResolution();
        if (secondary) identities.add(metadata(), { id: 1 }, new ScopeRow());
        const model = metadata();
        const events: string[] = [];
        const bound = {
            get id(): number {
                expect(identities.get(model, {
                    get id(): number {
                        events.push('published');
                        return 2;
                    },
                })).toBeUndefined();
                identities.clear();
                return 1;
            },
        };

        identities.add(model, bound, new ScopeRow());
        expect(events).toEqual(['published']);
        expect(identities.get(model, { id: 1 })).toBeUndefined();
    });
});

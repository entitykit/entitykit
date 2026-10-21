import { compileModel, type ModelBuilder as PublicModelBuilder } from '../packages/core/src';
import { Materializer } from '../packages/core/src/experimental';
import { compiledModelMetadata } from '../packages/core/src/model/compiled-model';
import { ModelBuilder } from '../packages/core/src/model/model-builder';
import type { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import { materializedPersistenceFacts } from '../packages/core/src/materialization/materialized-bound-values';
import { requireDefined } from './support/require-defined';

class JsonRow {
    public id = 0;
    public document: unknown;
}

function metadata(compiled: boolean): EntityMetadata<JsonRow> {
    const configure = (model: PublicModelBuilder): void => {
        model.entity(JsonRow, entity => {
            entity.toTable('json_rows').hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer');
            entity.property(row => row.document).hasColumnType('jsonb');
        });
    };
    if (compiled) return compiledModelMetadata(compileModel(configure, { provider: 'postgres' })).getEntity(JsonRow);
    const builder = new ModelBuilder();configure(builder);
    return builder.build().getEntity(JsonRow);
}

describe('JSON ownership observations during materialization', () => {
    it.each([false, true])('validates the second source observation after both traversals, compiled %s', compiled => {
        const model = metadata(compiled);
        const events: string[] = [];
        let reads = 0, tails = 0, failure: unknown;
        const source = {
            list: [{ get poison(): unknown {
                events.push(`poison ${String(++reads)}`);
                return reads === 2 ? (): undefined => undefined : 0;
            } }],
            get tail() {
                events.push(`tail ${String(++tails)}`);return 'after';
            },
        };
        try {
            new Materializer().materializeUntracked(model, { id: 1, document: source });
        } catch (error) {
            failure = error;
        }
        expect(events).toEqual(['poison 1', 'tail 1', 'poison 2', 'tail 2']);
        expect(failure).toBeInstanceOf(TypeError);
        expect((failure as Error).message).toContain('\'JsonRow.document.list[0].poison\' (function)');
    });

    it.each([false, true])('owns earlier values when a later source getter mutates its input, compiled %s', compiled => {
        const model = metadata(compiled);
        let reads = 0;
        const source = {
            list: [{ proofMarker: 1 }],
            get trigger() {
                reads++;
                if (reads === 2) requireDefined(source.list[0]).proofMarker = 99;
                return 'after';
            },
        };
        const entity = new Materializer().materializeUntracked(model, { id: 2, document: source });
        const bound = requireDefined(materializedPersistenceFacts(entity)).boundValues.document;
        expect(reads).toBe(2);
        expect(source.list).toEqual([{ proofMarker: 99 }]);
        expect(entity.document).toEqual({ list: [{ proofMarker: 1 }], trigger: 'after' });
        expect(bound).toBe('{"list":[{"proofMarker":1}],"trigger":"after"}');
    });
});

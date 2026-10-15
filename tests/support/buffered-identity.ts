import { compileModel, type ModelBuilder as PublicModelBuilder } from '../../packages/core/src';
import { compiledModelMetadata } from '../../packages/core/src/model/compiled-model';
import { ModelBuilder } from '../../packages/core/src/model/model-builder';
import { createBufferedQueryIdentities } from '../../packages/core/src/materialization/buffered-query-identities';
import { createBufferedQueryMaterializer } from '../../packages/core/src/materialization/buffered-query-materializer';
import { ChangeTracker } from '../../packages/core/src/tracking/change-tracker';
import type { Model } from '../../packages/core/src/model/model';
import type { EntityMetadata } from '../../packages/core/src/model/entity-metadata';
import type { QueryIdentityResolution } from '../../packages/core/src/materialization/query-identity-resolution';
import type { Materializer } from '../../packages/core/src/materialization/materializer';
import type { MaterializedRow } from '../../packages/core/src/materialization/materialized-row';

interface BufferedIdentityRow { id: unknown; name: string }
interface BufferedIdentityScope {
    model: Model;
    metadata: EntityMetadata<BufferedIdentityRow>;
    identities: QueryIdentityResolution;
    materializer: Materializer;
    tracker: ChangeTracker;
    read(id: unknown, name?: string): MaterializedRow<BufferedIdentityRow>;
}

export function bufferedIdentityScope(compiled = true, construct: () => void = () => undefined): BufferedIdentityScope {
    class Row {
        public id: unknown = 0;
        public name = '';
        constructor() {
            construct();
        }
    }
    const configure = (builder: PublicModelBuilder): void => {
        builder.entity(Row, entity => {
            entity.toTable('receipt_rows').hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
        });
    };
    const builder = new ModelBuilder();
    if (!compiled) configure(builder);
    const model = compiled ? compiledModelMetadata(compileModel(configure, { provider: 'sqlite' })) : builder.build();
    const metadata = model.getEntity(Row);
    const identities = createBufferedQueryIdentities(model);
    const materializer = createBufferedQueryMaterializer(undefined, identities);
    const tracker = new ChangeTracker();
    return {
        model, metadata, identities, materializer, tracker,
        read: (id: unknown, name = 'value') => materializer.materializeManyWithValues(metadata, [{ id, name }], tracker)[0],
    };
}

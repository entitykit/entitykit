import { compileModel, type ModelBuilder as PublicModelBuilder } from '../../packages/core/src';
import { compiledModelMetadata } from '../../packages/core/src/model/compiled-model';
import { ModelBuilder } from '../../packages/core/src/model/model-builder';
import type { EntityMetadata } from '../../packages/core/src/model/entity-metadata';

export class PlannedRow {
    public id = 0;
    public value: unknown;
    public tail = 0;
}

export function entityReadMetadata(
    compiled = true,
    ctor: new () => PlannedRow = PlannedRow,
    columnType = 'text',
): EntityMetadata<PlannedRow> {
    const configure = (model: PublicModelBuilder): void => {
        model.entity(ctor, entity => {
            entity.toTable('planned_rows').hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            entity.property(row => row.value).hasColumnName('stored_value').hasColumnType(columnType);
            entity.property(row => row.tail).hasColumnType('integer');
        });
    };
    if (compiled) return compiledModelMetadata(compileModel(configure, { provider: 'sqlite' })).getEntity<PlannedRow>(ctor);
    const builder = new ModelBuilder();configure(builder);return builder.build().getEntity<PlannedRow>(ctor);
}

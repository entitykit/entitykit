import { compileModel, type ModelBuilder as PublicModelBuilder } from '../../packages/core/src';
import { compiledModelMetadata } from '../../packages/core/src/model/compiled-model';
import { ModelBuilder } from '../../packages/core/src/model/model-builder';
import type { Model } from '../../packages/core/src/model/model';
import { createQueryModel, type QueryModel } from '../../packages/core/src/query/query-model';
import type { ProjectionFieldExpression } from '../../packages/core/src/query/projection-expression-types';

export class ProjectionRow {
    public id = 0;
    public label = '';
    public timestamp: Date | null = null;
}
export function projectionMapping(model: PublicModelBuilder): void {
    model.entity(ProjectionRow, entity => {
        entity.toTable('projection_rows').hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('integer').isRequired();
        entity.property(row => row.label).hasColumnType('text').isRequired();
        entity.property(row => row.timestamp).hasColumnType('timestamp');
    });
}
export function projectionMetadata(compiled = true): Model {
    if (compiled) return compiledModelMetadata(compileModel(projectionMapping, { provider: 'sqlite' }));
    const builder = new ModelBuilder();projectionMapping(builder);return builder.build();
}
export function projectionField(alias: string, propertyName = alias): ProjectionFieldExpression {
    return { kind: 'field', alias, propertyName, sourceAlias: undefined, path: undefined };
}
export function projectionQuery(projection = [projectionField('id'), projectionField('label')]): QueryModel<ProjectionRow> {
    return { ...createQueryModel(ProjectionRow), projection };
}

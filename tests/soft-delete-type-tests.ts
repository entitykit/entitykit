import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';

class SoftDeleteTypeRow {
    public id!: string;
    public deletedAt?: Date | null;
    public deletedState?: string | null;
    public deletedFlag?: boolean | null;
    public deletedCode?: number | null;
}

const model = new ModelBuilderImplementation();
model.entity(SoftDeleteTypeRow, entity => {
    entity.toTable('soft_delete_type_rows');
    entity.hasKey(row => row.id);
    entity.property(row => row.id).hasColumnType('text').isRequired();

    entity.softDelete(row => row.deletedAt);
    entity.softDelete(row => row.deletedState, 'deleted');
    entity.softDelete(row => row.deletedFlag, true);
    entity.softDelete(row => row.deletedCode, 7);
    entity.softDelete('deletedState', 'deleted');

    // @ts-expect-error non-temporal selectors require an explicit marker
    entity.softDelete(row => row.deletedState);
    // @ts-expect-error explicit markers must match the selected property type
    entity.softDelete(row => row.deletedFlag, 'deleted');
    // @ts-expect-error property-name configuration always requires a marker
    entity.softDelete('deletedAt');
});

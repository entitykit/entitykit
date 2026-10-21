import {
    compiledModelMetadata,
    validateCompiledModelProvider,
    type CompiledModel,
} from '../../model/compiled-model';
import type { Model } from '../../model/model';
import { validateIndexDatabaseNames } from '../../model/index-name-validation';
import { ModelValidationError } from '../../errors/model-validation-error';

const selections: WeakMap<object, CompiledModel> = new WeakMap();

export function selectCompiledModel(owner: object, handle: CompiledModel): void {
    compiledModelMetadata(handle);
    if (selections.has(owner)) throw new ModelValidationError('A compiled model is already selected.');
    selections.set(owner, handle);
}

export function selectedCompiledModel(owner: object): CompiledModel | undefined {
    return selections.get(owner);
}

/** Runs before ProviderSelection invokes any connection factory. */
export function validateContextModel(owner: object, model: Model | undefined, provider: string, dialect: string): void {
    const selected = selections.get(owner);
    if (selected) {
        validateCompiledModelProvider(selected, provider, dialect);
        if (model && model !== compiledModelMetadata(selected)) {
            throw new ModelValidationError('The context model differs from its selected compiled model.');
        }
        return;
    }
    for (const entity of model?.entities ?? []) validateIndexDatabaseNames(entity, dialect);
}

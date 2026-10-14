import { ModelBuilder } from './model-builder';
import type { ModelBuilder as PublicModelBuilder } from './model-builder-types';
import type { Model } from './model';
import { copyCompiledModel } from './compiled-model-copy';
import { validateIndexDatabaseNames } from './index-name-validation';
import { ModelValidationError } from '../errors/model-validation-error';
import { assertSynchronousCallbackResult } from '../synchronous-callback';

declare const compiledModelBrand: unique symbol;

/** Explicitly owned mapping shared by contexts; contains no request state. */
export interface CompiledModel {
    readonly [compiledModelBrand]: true;
    /** Provider registration name this mapping was compiled for. */
    readonly provider: string;
    /** Runtime SQL dialect name required by this mapping. */
    readonly dialect: string;
}

export interface CompiledModelOptions {
    readonly provider: string;
    /** Defaults to provider; custom registrations may use a different dialect. */
    readonly dialect?: string;
}

const models: WeakMap<CompiledModel, Model> = new WeakMap();
const ownedModels: WeakSet<Model> = new WeakSet();

/** Compile a callback-free, flat model once; ordinary model() remains dynamic. */
export function compileModel(
    configure: (model: PublicModelBuilder) => unknown,
    options: CompiledModelOptions,
): CompiledModel {
    const provider = options.provider;
    const dialect = options.dialect ?? provider;
    if (typeof provider !== 'string' || !provider.trim() || typeof dialect !== 'string' || !dialect.trim()) {
        throw new ModelValidationError('Compiled models require nonempty provider and dialect names.');
    }
    const builder = new ModelBuilder();
    assertSynchronousCallbackResult(configure(builder), 'compileModel()', message =>
        new ModelValidationError(message, { contractViolation: 'asyncCompiledModel' }));
    const model = copyCompiledModel(builder.build());
    for (const entity of model.entities) validateIndexDatabaseNames(entity, dialect);
    const handle = Object.freeze({ provider, dialect }) as CompiledModel;
    models.set(handle, model);
    ownedModels.add(model);
    return handle;
}

/** Internal eligibility proof; freezing caller-owned metadata is insufficient. */
export function isCompiledModelMetadata(model: Model): boolean {
    return ownedModels.has(model);
}

/** Internal bootstrap seam; forged handles never select a shared mapping. */
export function compiledModelMetadata(handle: CompiledModel): Model {
    const model = models.get(handle);
    if (!model) throw new ModelValidationError('Expected a handle returned by compileModel().');
    return model;
}

export function validateCompiledModelProvider(handle: CompiledModel, provider: string, dialect: string): void {
    compiledModelMetadata(handle);
    if (handle.provider !== provider || handle.dialect !== dialect) {
        throw new ModelValidationError(
            `Compiled model requires provider '${handle.provider}' and dialect '${handle.dialect}', ` +
            `but this context uses '${provider}' and '${dialect}'.`,
            { contractViolation: 'compiledModelProviderMismatch' },
        );
    }
}

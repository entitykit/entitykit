/** Public contract for value converter. */ export interface ValueConverter<
    TModel = unknown,
    TProvider = unknown,
> {
    /** Perform the to provider operation. */ toProvider(value: TModel): TProvider;
    /** Perform the from provider operation. */ fromProvider(value: TProvider): TModel;
}

/** Perform the value converter operation. */ export function valueConverter<TModel, TProvider>(
    converter: ValueConverter<TModel, TProvider>,
): ValueConverter<TModel, TProvider> {
    return converter;
}

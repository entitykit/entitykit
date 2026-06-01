import type { ValueConverter } from './converter';

/** Perform the enum string operation. */ export function enumString<
    TEnum extends string,
>(): ValueConverter<TEnum, string> {
    return {
        toProvider(value: TEnum): string {
            return value;
        },
        fromProvider(value: string): TEnum {
            return value as TEnum;
        },
    };
}

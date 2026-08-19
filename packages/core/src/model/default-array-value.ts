import { withDefaultAncestor } from './default-value-ancestor';

type NormalizeDefaultChild = (
    value: unknown,
    path: string,
    nested: boolean,
    ancestors: Set<object>,
) => unknown;

type UnsupportedDefault = (path: string, actual: string) => Error;

export function normalizeDefaultArray(
    value: unknown[],
    path: string,
    ancestors: Set<object>,
    normalize: NormalizeDefaultChild,
    unsupported: UnsupportedDefault,
): unknown[] {
    return withDefaultAncestor(value, path, ancestors, () => {
        let descriptors: PropertyDescriptorMap;
        try {
            descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
        } catch {
            throw unsupported(path, 'property inspection failed');
        }

        const length = Number(descriptors.length.value);
        const normalized: unknown[] = [];
        let firstError: Error | undefined;
        const inspect = (work: () => unknown): unknown => {
            try {
                return work();
            } catch (error) {
                firstError ??= error instanceof Error
                    ? error
                    : new Error(String(error));
                return undefined;
            }
        };

        for (let index = 0; index < length; index += 1) {
            const key = String(index);
            if (!Object.prototype.hasOwnProperty.call(descriptors, key)) {
                inspect(() => {
                    throw unsupported(`${path}[${key}]`, 'missing array element');
                });
                normalized.push(undefined);
                continue;
            }
            const descriptor = descriptors[key];
            normalized.push(inspect(() => normalizeDescriptor(
                descriptor,
                `${path}[${key}]`,
                ancestors,
                normalize,
                unsupported,
            )));
        }

        for (const key of Reflect.ownKeys(descriptors)) {
            if (key === 'length' || isArrayIndex(key, length)) {
                continue;
            }
            const descriptor = descriptors[key];
            if (typeof key === 'string' && !descriptor.enumerable) {
                continue;
            }
            inspect(() => {
                throw unsupported(
                    path,
                    typeof key === 'symbol'
                        ? 'symbol-keyed property'
                        : `extra array property '${key}'`,
                );
            });
            if ('value' in descriptor) {
                inspect(() => normalize(
                    descriptor.value,
                    `${path}.${String(key)}`,
                    true,
                    ancestors,
                ));
            }
        }

        if (firstError) {
            throw firstError;
        }
        return normalized;
    }, cycle => unsupported(cycle, 'cyclic reference'));
}

function normalizeDescriptor(
    descriptor: PropertyDescriptor,
    path: string,
    ancestors: Set<object>,
    normalize: NormalizeDefaultChild,
    unsupported: UnsupportedDefault,
): unknown {
    if (!('value' in descriptor)) {
        throw unsupported(path, 'accessor property');
    }
    return normalize(descriptor.value, path, true, ancestors);
}

function isArrayIndex(key: PropertyKey, length: number): boolean {
    if (typeof key !== 'string' || key.length === 0) {
        return false;
    }
    const index = Number(key);
    return Number.isInteger(index) &&
        index >= 0 &&
        index < length &&
        String(index) === key;
}

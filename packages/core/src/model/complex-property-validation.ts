import type { ComplexPropertyMetadata } from './complex-property-metadata';
import type { PropertyMetadata } from './property-metadata';

/** Keep optional-object null semantics compatible with relational nullability. */
export function validateComplexPropertyRequiredness(
    entityName: string,
    complexProperties: readonly ComplexPropertyMetadata[],
    properties: readonly PropertyMetadata[],
): void {
    for (const complex of complexProperties) {
        if (complex.isRequired) {
            continue;
        }
        const requiredLeaf = properties.find(property =>
            property.isRequired &&
            property.propertyPath.length > complex.propertyPath.length &&
            complex.propertyPath.every(
                (segment, index) => property.propertyPath[index] === segment,
            ));
        if (requiredLeaf) {
            throw new Error(
                `Optional complex property '${entityName}.${complex.propertyName}' cannot contain required leaf '${requiredLeaf.propertyName}'. Make the complex property required or configure the leaf as optional.`,
            );
        }
    }
}

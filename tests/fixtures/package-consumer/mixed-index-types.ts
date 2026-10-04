import type { EntityBuilder, IndexKeyPart } from '@entitykit/core';
class Book { public id = 0; public edition = ''; public title = ''; }
declare const entity: EntityBuilder<Book>;
const parts: readonly IndexKeyPart<Book>[] = [
    { kind: 'property', propertyName: 'edition' },
    { kind: 'expression', expression: 'lower("title")' },
];
entity.hasIndex(parts).hasDatabaseName('ix_books').isUnique().includeProperties(row => row.id);
entity.hasIndex('edition');
entity.hasIndex(row => [row.edition, row.title]);
entity.hasExpressionIndex('lower("title")');
// @ts-expect-error property keys must name a mapped entity member
entity.hasIndex([{ kind: 'property', propertyName: 'missing' }]);
// @ts-expect-error raw SQL expressions must be strings
entity.hasIndex([{ kind: 'expression', expression: 42 }]);
// @ts-expect-error store column descriptors are not mapped property descriptors
entity.hasIndex([{ kind: 'column', name: 'edition' }]);
// @ts-expect-error descriptors require their key value
entity.hasIndex([{ kind: 'property' }]);
// @ts-expect-error a bare array of names is not an ordered descriptor list
entity.hasIndex(['edition', 'title']);

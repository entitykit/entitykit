/**
 * Compatibility exports for the original model snapshot module.
 *
 * Production modules import the snapshot contract and serializer directly.
 */
export { createModelSnapshot } from './model-snapshot-serializer';
export type {
    AuditSnapshot,
    AlternateKeySnapshot,
    CheckConstraintSnapshot,
    EntitySnapshot,
    IndexSnapshot,
    IndexKeyPartSnapshot,
    ManyToManySnapshot,
    ModelSnapshot,
    PropertySnapshot,
    RelationshipSnapshot,
    SequenceSnapshot,
    SoftDeleteSnapshot,
} from './model-snapshot-types';

/** Schema inspection and code-generation APIs for EntityKit tooling. */
export type {
    AlternateKeySnapshot,
    AuditSnapshot,
    CheckConstraintSnapshot,
    EntitySnapshot,
    IndexKeyPartSnapshot,
    IndexSnapshot,
    ManyToManySnapshot,
    ModelSnapshot,
    PropertySnapshot,
    RelationshipSnapshot,
    SequenceSnapshot,
    SoftDeleteSnapshot,
} from '../model/model-snapshot-types';
export type {
    DatabaseCheckConstraint,
    DatabaseColumn,
    DatabaseForeignKey,
    DatabaseIndex,
    DatabaseIndexKeyPart,
    DatabasePrimaryKey,
    DatabaseSchema,
    DatabaseSchemaIntrospectionOptions,
    DatabaseSchemaSnapshot,
    DatabaseSequence,
    DatabaseTable,
} from '../introspection/database-schema';
export {
    generateDbPullCode,
    generateDbPullCodeWithDiagnostics,
} from '../introspection/db-pull-code-generator';
export type {
    DbPullCodegenOptions,
    DbPullCodegenResult,
    DbPullDiagnostic,
    GeneratedCodeFile,
} from '../introspection/db-pull-code-generator';
export type { IdentityGenerationMode, StoreGenerationStrategy } from '../model/store-generation';

// Generation is only half the job: anything that writes generated code needs the
// same all-or-nothing file writer and path guard the CLI uses, and anything that
// reads a TypeScript config or migration needs the same module loader.
export { safeGeneratedPath, writeFilesAtomically } from './atomic-file-writer';
export type { AtomicFileWrite } from './atomic-file-writer';
export { loadTypeScriptModule } from './typescript-module-loader';

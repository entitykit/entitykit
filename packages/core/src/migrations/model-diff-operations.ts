import type {
    AddColumnOperation,
    AlterColumnOperation,
    CreateIndexOperation,
    CreateTableOperation,
    DropColumnOperation,
    DropIndexOperation,
    DropTableOperation,
    RenameTableOperation,
} from './model-diff-table-operations';
import type {
    AddCheckConstraintOperation,
    AddForeignKeyOperation,
    AlterSequenceOperation,
    CreateJoinTableOperation,
    CreateSequenceOperation,
    DropCheckConstraintOperation,
    DropForeignKeyOperation,
    DropJoinTableOperation,
    DropSequenceOperation,
    RebuildTableOperation,
} from './model-diff-schema-operations';

/** Migration operation describing model diff. */ export type ModelDiffOperation =
    | CreateTableOperation | RenameTableOperation | DropTableOperation
    | AddColumnOperation | AlterColumnOperation | DropColumnOperation
    | CreateIndexOperation | DropIndexOperation
    | AddForeignKeyOperation | DropForeignKeyOperation
    | AddCheckConstraintOperation | DropCheckConstraintOperation
    | CreateSequenceOperation | AlterSequenceOperation | DropSequenceOperation
    | RebuildTableOperation | CreateJoinTableOperation | DropJoinTableOperation;

export type {
    AddColumnOperation,
    AlterColumnOperation,
    CreateIndexOperation,
    CreateTableOperation,
    DropColumnOperation,
    DropIndexOperation,
    DropTableOperation,
    RenameTableOperation,
} from './model-diff-table-operations';
export type {
    AddCheckConstraintOperation,
    AddForeignKeyOperation,
    AlterSequenceOperation,
    CreateJoinTableOperation,
    CreateSequenceOperation,
    DropCheckConstraintOperation,
    DropForeignKeyOperation,
    DropJoinTableOperation,
    DropSequenceOperation,
    RebuildTableOperation,
} from './model-diff-schema-operations';

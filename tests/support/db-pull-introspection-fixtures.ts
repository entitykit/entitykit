export interface DbPullQueryResult {
    readonly rows: ReadonlyArray<Record<string, unknown>>;
    readonly rowCount: number;
}

export type DbPullQueryImplementation = (
    text: string,
    values: readonly unknown[],
) => DbPullQueryResult | Promise<DbPullQueryResult>;

export const standardDbPullIntrospection: DbPullQueryImplementation = (
    text,
    values,
) => {
    if (text.includes('information_schema.columns')) {
        return {
            rows: [
                {
                    table_schema: 'app',
                    table_name: 'users',
                    column_name: 'id',
                    ordinal_position: 1,
                    data_type: 'uuid',
                    udt_name: 'uuid',
                    character_maximum_length: null,
                    numeric_precision: null,
                    numeric_scale: null,
                    is_nullable: 'NO',
                    column_default: null,
                },
                {
                    table_schema: 'app',
                    table_name: 'users',
                    column_name: 'email',
                    ordinal_position: 2,
                    data_type: 'character varying',
                    udt_name: 'varchar',
                    character_maximum_length: 255,
                    numeric_precision: null,
                    numeric_scale: null,
                    is_nullable: 'NO',
                    column_default: null,
                },
            ],
            rowCount: 2,
        };
    }

    if (text.includes('PRIMARY KEY')) {
        return {
            rows: [{
                table_schema: 'app',
                table_name: 'users',
                constraint_name: 'pk_users',
                columns: ['id'],
            }],
            rowCount: 1,
        };
    }

    if (text.includes('from pg_index')) {
        return {
            rows: [{
                table_schema: 'app',
                table_name: 'users',
                index_name: 'ux_users_email',
                columns: ['email'],
                is_unique: true,
            }],
            rowCount: 1,
        };
    }

    if (text.includes('FOREIGN KEY')) {
        return { rows: [], rowCount: 0 };
    }
    if (text.includes('from pg_constraint')) {
        return { rows: [], rowCount: 0 };
    }
    if (text.includes('from pg_sequences')) {
        return { rows: [], rowCount: 0 };
    }

    throw new Error(`Unexpected introspection query: ${text} ${JSON.stringify(values)}`);
};

export const reviewDbPullIntrospection: DbPullQueryImplementation = (
    text,
    values,
) => {
    if (text.includes('information_schema.columns')) {
        return {
            rows: [
                {
                    table_schema: 'app',
                    table_name: 'posts',
                    column_name: 'id',
                    ordinal_position: 1,
                    data_type: 'uuid',
                    udt_name: 'uuid',
                    character_maximum_length: null,
                    numeric_precision: null,
                    numeric_scale: null,
                    is_nullable: 'NO',
                    column_default: null,
                },
                {
                    table_schema: 'app',
                    table_name: 'posts',
                    column_name: 'author_id',
                    ordinal_position: 2,
                    data_type: 'uuid',
                    udt_name: 'uuid',
                    character_maximum_length: null,
                    numeric_precision: null,
                    numeric_scale: null,
                    is_nullable: 'NO',
                    column_default: null,
                },
                {
                    table_schema: 'app',
                    table_name: 'posts',
                    column_name: 'review_state',
                    ordinal_position: 3,
                    data_type: 'USER-DEFINED',
                    udt_name: 'review_state',
                    character_maximum_length: null,
                    numeric_precision: null,
                    numeric_scale: null,
                    is_nullable: 'NO',
                    column_default: null,
                },
            ],
            rowCount: 3,
        };
    }

    if (text.includes('PRIMARY KEY')) {
        return { rows: [], rowCount: 0 };
    }

    if (text.includes('from pg_index')) {
        return {
            rows: [{
                table_schema: 'app',
                table_name: 'posts',
                index_name: 'ix_posts_review_lookup',
                columns: ['review_state', 'review_state_sort_key'],
                is_unique: false,
            }],
            rowCount: 1,
        };
    }

    if (text.includes('FOREIGN KEY')) {
        return {
            rows: [{
                table_schema: 'app',
                table_name: 'posts',
                constraint_name: 'fk_posts_auth_users_author_id',
                columns: ['author_id'],
                foreign_table_schema: 'auth',
                foreign_table_name: 'users',
                foreign_columns: ['id'],
                delete_rule: 'CASCADE',
            }],
            rowCount: 1,
        };
    }
    if (text.includes('from pg_constraint')) {
        return { rows: [], rowCount: 0 };
    }
    if (text.includes('from pg_sequences')) {
        return { rows: [], rowCount: 0 };
    }

    throw new Error(`Unexpected introspection query: ${text} ${JSON.stringify(values)}`);
};

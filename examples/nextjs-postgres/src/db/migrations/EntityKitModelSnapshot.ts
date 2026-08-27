import type { ModelSnapshot } from "@entitykit/core/migrations";

export default {
  "formatVersion": 1,
  "entities": [
    {
      "entityName": "Author",
      "tableName": "authors",
      "keyProperty": "id",
      "keyProperties": ["id"],
      "properties": [
        { "propertyName": "id", "columnName": "id", "columnType": "text", "isRequired": true, "isPrimaryKey": true, "isUnique": false, "hasConverter": false, "isConcurrencyToken": false, "isVersion": false },
        { "propertyName": "displayName", "columnName": "display_name", "columnType": "text", "isRequired": true, "isPrimaryKey": false, "isUnique": false, "hasConverter": false, "isConcurrencyToken": false, "isVersion": false },
        { "propertyName": "bio", "columnName": "bio", "columnType": "text", "isRequired": true, "isPrimaryKey": false, "isUnique": false, "hasConverter": false, "isConcurrencyToken": false, "isVersion": false },
        { "propertyName": "createdAt", "columnName": "created_at", "columnType": "timestamptz", "isRequired": true, "isPrimaryKey": false, "isUnique": false, "hasConverter": false, "isConcurrencyToken": false, "isVersion": false }
      ],
      "ignoredProperties": [],
      "indexes": [],
      "relationships": [],
      "manyToManyRelationships": []
    },
    {
      "entityName": "Post",
      "tableName": "posts",
      "keyProperty": "id",
      "keyProperties": ["id"],
      "properties": [
        { "propertyName": "id", "columnName": "id", "columnType": "text", "isRequired": true, "isPrimaryKey": true, "isUnique": false, "hasConverter": false, "isConcurrencyToken": false, "isVersion": false },
        { "propertyName": "workspaceId", "columnName": "workspace_id", "columnType": "text", "isRequired": true, "isPrimaryKey": false, "isUnique": false, "hasConverter": false, "isConcurrencyToken": false, "isVersion": false },
        { "propertyName": "authorId", "columnName": "author_id", "columnType": "text", "isRequired": true, "isPrimaryKey": false, "isUnique": false, "hasConverter": false, "isConcurrencyToken": false, "isVersion": false },
        { "propertyName": "slug", "columnName": "slug", "columnType": "text", "isRequired": true, "isPrimaryKey": false, "isUnique": false, "hasConverter": false, "isConcurrencyToken": false, "isVersion": false },
        { "propertyName": "title", "columnName": "title", "columnType": "text", "isRequired": true, "isPrimaryKey": false, "isUnique": false, "hasConverter": false, "isConcurrencyToken": false, "isVersion": false },
        { "propertyName": "dek", "columnName": "dek", "columnType": "text", "isRequired": true, "isPrimaryKey": false, "isUnique": false, "hasConverter": false, "isConcurrencyToken": false, "isVersion": false },
        { "propertyName": "body", "columnName": "body", "columnType": "text", "isRequired": true, "isPrimaryKey": false, "isUnique": false, "hasConverter": false, "isConcurrencyToken": false, "isVersion": false },
        { "propertyName": "status", "columnName": "status", "columnType": "text", "isRequired": true, "isPrimaryKey": false, "isUnique": false, "hasConverter": true, "isConcurrencyToken": false, "isVersion": false },
        { "propertyName": "publishedAt", "columnName": "published_at", "columnType": "timestamptz", "isRequired": false, "isPrimaryKey": false, "isUnique": false, "hasConverter": false, "isConcurrencyToken": false, "isVersion": false },
        { "propertyName": "createdAt", "columnName": "created_at", "columnType": "timestamptz", "isRequired": true, "isPrimaryKey": false, "isUnique": false, "hasConverter": false, "isConcurrencyToken": false, "isVersion": false },
        { "propertyName": "updatedAt", "columnName": "updated_at", "columnType": "timestamptz", "isRequired": true, "isPrimaryKey": false, "isUnique": false, "hasConverter": false, "isConcurrencyToken": false, "isVersion": false }
      ],
      "ignoredProperties": [],
      "indexes": [
        { "propertyNames": ["workspaceId", "slug"], "isUnique": true, "databaseName": "ux_posts_workspace_slug" },
        { "propertyNames": ["workspaceId", "status", "publishedAt"], "isUnique": false, "databaseName": "ix_posts_publication" }
      ],
      "relationships": [
        { "navigationProperty": "workspace", "principalEntityName": "Workspace", "inverseNavigationProperty": "posts", "foreignKeyProperty": "workspaceId", "foreignKeyProperties": ["workspaceId"], "deleteBehavior": "cascade" },
        { "navigationProperty": "author", "principalEntityName": "Author", "inverseNavigationProperty": "posts", "foreignKeyProperty": "authorId", "foreignKeyProperties": ["authorId"], "deleteBehavior": "no action" }
      ],
      "manyToManyRelationships": [
        { "navigationProperty": "tags", "targetEntityName": "Tag", "inverseNavigationProperty": "posts", "joinTableName": "post_tags", "sourceForeignKeyColumn": "post_id", "targetForeignKeyColumn": "tag_id", "sourceForeignKeyColumns": ["post_id"], "targetForeignKeyColumns": ["tag_id"], "deleteBehavior": "cascade" }
      ]
    },
    {
      "entityName": "Tag",
      "tableName": "tags",
      "keyProperty": "id",
      "keyProperties": ["id"],
      "properties": [
        { "propertyName": "id", "columnName": "id", "columnType": "text", "isRequired": true, "isPrimaryKey": true, "isUnique": false, "hasConverter": false, "isConcurrencyToken": false, "isVersion": false },
        { "propertyName": "workspaceId", "columnName": "workspace_id", "columnType": "text", "isRequired": true, "isPrimaryKey": false, "isUnique": false, "hasConverter": false, "isConcurrencyToken": false, "isVersion": false },
        { "propertyName": "name", "columnName": "name", "columnType": "text", "isRequired": true, "isPrimaryKey": false, "isUnique": false, "hasConverter": false, "isConcurrencyToken": false, "isVersion": false },
        { "propertyName": "slug", "columnName": "slug", "columnType": "text", "isRequired": true, "isPrimaryKey": false, "isUnique": false, "hasConverter": false, "isConcurrencyToken": false, "isVersion": false }
      ],
      "ignoredProperties": [],
      "indexes": [
        { "propertyNames": ["workspaceId", "slug"], "isUnique": true, "databaseName": "ux_tags_workspace_slug" }
      ],
      "relationships": [],
      "manyToManyRelationships": []
    },
    {
      "entityName": "Workspace",
      "tableName": "workspaces",
      "keyProperty": "id",
      "keyProperties": ["id"],
      "properties": [
        { "propertyName": "id", "columnName": "id", "columnType": "text", "isRequired": true, "isPrimaryKey": true, "isUnique": false, "hasConverter": false, "isConcurrencyToken": false, "isVersion": false },
        { "propertyName": "slug", "columnName": "slug", "columnType": "text", "isRequired": true, "isPrimaryKey": false, "isUnique": false, "hasConverter": false, "isConcurrencyToken": false, "isVersion": false },
        { "propertyName": "name", "columnName": "name", "columnType": "text", "isRequired": true, "isPrimaryKey": false, "isUnique": false, "hasConverter": false, "isConcurrencyToken": false, "isVersion": false },
        { "propertyName": "description", "columnName": "description", "columnType": "text", "isRequired": true, "isPrimaryKey": false, "isUnique": false, "hasConverter": false, "isConcurrencyToken": false, "isVersion": false },
        { "propertyName": "createdAt", "columnName": "created_at", "columnType": "timestamptz", "isRequired": true, "isPrimaryKey": false, "isUnique": false, "hasConverter": false, "isConcurrencyToken": false, "isVersion": false }
      ],
      "ignoredProperties": [],
      "indexes": [
        { "propertyNames": ["slug"], "isUnique": true, "databaseName": "ux_workspaces_slug" }
      ],
      "relationships": [],
      "manyToManyRelationships": []
    }
  ]
} satisfies ModelSnapshot;

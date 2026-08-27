import {
  Migration,
  type MigrationBuilder,
  type ModelSnapshot,
} from "@entitykit/core/migrations";
import targetSnapshot from "./EntityKitModelSnapshot";

export default class InitialCreate extends Migration {
  readonly id = "20260827180000_InitialCreate";
  readonly name = "InitialCreate";
  override readonly previousSnapshot = {
    formatVersion: 1,
    entities: [],
  } satisfies ModelSnapshot;
  override readonly targetSnapshot = targetSnapshot;

  override up(builder: MigrationBuilder): void {
    builder.createTable("workspaces", [
      { name: "id", type: "text", nullable: false, primaryKey: true },
      { name: "slug", type: "text", nullable: false },
      { name: "name", type: "text", nullable: false },
      { name: "description", type: "text", nullable: false },
      { name: "created_at", type: "timestamptz", nullable: false },
    ]);
    builder.createTable("authors", [
      { name: "id", type: "text", nullable: false, primaryKey: true },
      { name: "display_name", type: "text", nullable: false },
      { name: "bio", type: "text", nullable: false },
      { name: "created_at", type: "timestamptz", nullable: false },
    ]);
    builder.createTable("tags", [
      { name: "id", type: "text", nullable: false, primaryKey: true },
      { name: "workspace_id", type: "text", nullable: false },
      { name: "name", type: "text", nullable: false },
      { name: "slug", type: "text", nullable: false },
    ]);
    builder.createTable("posts", [
      { name: "id", type: "text", nullable: false, primaryKey: true },
      { name: "workspace_id", type: "text", nullable: false },
      { name: "author_id", type: "text", nullable: false },
      { name: "slug", type: "text", nullable: false },
      { name: "title", type: "text", nullable: false },
      { name: "dek", type: "text", nullable: false },
      { name: "body", type: "text", nullable: false },
      { name: "status", type: "text", nullable: false },
      { name: "published_at", type: "timestamptz", nullable: true },
      { name: "created_at", type: "timestamptz", nullable: false },
      { name: "updated_at", type: "timestamptz", nullable: false },
    ], undefined, {
      foreignKeys: [
        {
          name: "fk_posts_workspaces_workspace_id",
          columns: ["workspace_id"],
          principalTableName: "workspaces",
          principalColumns: ["id"],
          onDelete: "cascade",
        },
        {
          name: "fk_posts_authors_author_id",
          columns: ["author_id"],
          principalTableName: "authors",
          principalColumns: ["id"],
          onDelete: "no action",
        },
      ],
    });
    builder.createTable("post_tags", [
      { name: "post_id", type: "text", nullable: false, primaryKey: true },
      { name: "tag_id", type: "text", nullable: false, primaryKey: true },
    ], undefined, {
      primaryKeyName: "pk_post_tags",
      foreignKeys: [
        {
          name: "fk_post_tags_posts_post_id",
          columns: ["post_id"],
          principalTableName: "posts",
          principalColumns: ["id"],
          onDelete: "cascade",
        },
        {
          name: "fk_post_tags_tags_tag_id",
          columns: ["tag_id"],
          principalTableName: "tags",
          principalColumns: ["id"],
          onDelete: "cascade",
        },
      ],
    });

    builder.createIndex({
      name: "ux_workspaces_slug",
      tableName: "workspaces",
      columns: ["slug"],
      unique: true,
    });
    builder.createIndex({
      name: "ux_tags_workspace_slug",
      tableName: "tags",
      columns: ["workspace_id", "slug"],
      unique: true,
    });
    builder.createIndex({
      name: "ux_posts_workspace_slug",
      tableName: "posts",
      columns: ["workspace_id", "slug"],
      unique: true,
    });
    builder.createIndex({
      name: "ix_posts_publication",
      tableName: "posts",
      columns: ["workspace_id", "status", "published_at"],
    });

    addDemoContent(builder);
  }

  override down(builder: MigrationBuilder): void {
    builder.dropTable("post_tags");
    builder.dropIndex("ix_posts_publication", undefined, { tableName: "posts" });
    builder.dropIndex("ux_posts_workspace_slug", undefined, { tableName: "posts" });
    builder.dropIndex("ux_tags_workspace_slug", undefined, { tableName: "tags" });
    builder.dropIndex("ux_workspaces_slug", undefined, { tableName: "workspaces" });
    builder.dropTable("posts");
    builder.dropTable("tags");
    builder.dropTable("authors");
    builder.dropTable("workspaces");
  }
}

function addDemoContent(builder: MigrationBuilder): void {
  builder.sql(`
    insert into workspaces (id, slug, name, description, created_at)
    values (
      'wrk_lantern',
      'lantern',
      'Lantern Journal',
      'Measured dispatches on software, systems, and the quiet work behind them.',
      '2026-08-27T18:00:00Z'
    )
  `);
  builder.sql(`
    insert into authors (id, display_name, bio, created_at)
    values (
      'usr_mara',
      'Mara Vale',
      'Mara writes about tools that make difficult work feel deliberate.',
      '2026-08-27T18:00:00Z'
    )
  `);
  builder.sql(`
    insert into tags (id, workspace_id, name, slug) values
      ('tag_craft', 'wrk_lantern', 'Craft', 'craft'),
      ('tag_systems', 'wrk_lantern', 'Systems', 'systems'),
      ('tag_types', 'wrk_lantern', 'TypeScript', 'typescript')
  `);
  builder.sql(`
    insert into posts (
      id, workspace_id, author_id, slug, title, dek, body, status,
      published_at, created_at, updated_at
    ) values (
      'post_context',
      'wrk_lantern',
      'usr_mara',
      'the-shape-of-a-useful-context',
      'The shape of a useful context',
      'A unit of work should be brief, explicit, and easy to leave behind.',
      'Long-lived database objects promise convenience, then quietly collect responsibilities. A useful context does less: it gives one operation a coherent identity map, one change set, and one place to finish.\n\nThat small boundary pays off in web applications. Every request can own its decisions, dispose its lease, and leave the shared pool ready for whatever arrives next.',
      'published',
      '2026-08-24T14:00:00Z',
      '2026-08-24T14:00:00Z',
      '2026-08-24T14:00:00Z'
    ), (
      'post_queries',
      'wrk_lantern',
      'usr_mara',
      'queries-are-product-design',
      'Queries are product design',
      'The best data layer makes the important path obvious without hiding its cost.',
      'A query API is not only syntax. It teaches an application which decisions deserve names: tracking or projection, bounded relationships or accidental graphs, explicit I/O or surprising work.\n\nGood tools make those choices visible at the point where they matter. The result is code that explains both what the screen needs and what the database will be asked to do.',
      'published',
      '2026-08-18T14:00:00Z',
      '2026-08-18T14:00:00Z',
      '2026-08-18T14:00:00Z'
    )
  `);
  builder.sql(`
    insert into post_tags (post_id, tag_id) values
      ('post_context', 'tag_craft'),
      ('post_context', 'tag_systems'),
      ('post_queries', 'tag_types'),
      ('post_queries', 'tag_craft')
  `);
}

import {
  DbContext,
  DeleteBehavior,
  enumString,
  type DbContextOptionsBuilder,
  type ModelBuilder,
} from "@entitykit/core";
import type { createPostgresDataSource } from "@entitykit/postgres";
import { Author } from "./model/author";
import { Post, type PostStatus } from "./model/post";
import { Tag } from "./model/tag";
import { Workspace } from "./model/workspace";
import { databaseUrl } from "./environment";

export type PublicationDataSource = ReturnType<typeof createPostgresDataSource>;

abstract class PublicationDbContext extends DbContext {
  readonly workspaces = this.set<Workspace, [id: string]>(Workspace);
  readonly authors = this.set<Author, [id: string]>(Author);
  readonly posts = this.set<Post, [id: string]>(Post);
  readonly tags = this.set<Tag, [id: string]>(Tag);

  protected override model(model: ModelBuilder): void {
    model.entity(Workspace, (entity) => {
      entity.toTable("workspaces");
      entity.hasKey((workspace) => workspace.id);
      entity.property((workspace) => workspace.id).hasColumnType("text").isRequired();
      entity.property((workspace) => workspace.slug).hasColumnType("text").isRequired();
      entity.property((workspace) => workspace.name).hasColumnType("text").isRequired();
      entity.property((workspace) => workspace.description).hasColumnType("text").isRequired();
      entity.property((workspace) => workspace.createdAt)
        .hasColumnName("created_at")
        .hasColumnType("timestamptz")
        .isRequired();
      entity.hasIndex((workspace) => workspace.slug)
        .hasDatabaseName("ux_workspaces_slug")
        .isUnique();
    });

    model.entity(Author, (entity) => {
      entity.toTable("authors");
      entity.hasKey((author) => author.id);
      entity.property((author) => author.id).hasColumnType("text").isRequired();
      entity.property((author) => author.displayName)
        .hasColumnName("display_name")
        .hasColumnType("text")
        .isRequired();
      entity.property((author) => author.bio).hasColumnType("text").isRequired();
      entity.property((author) => author.createdAt)
        .hasColumnName("created_at")
        .hasColumnType("timestamptz")
        .isRequired();
    });

    model.entity(Post, (entity) => {
      entity.toTable("posts");
      entity.hasKey((post) => post.id);
      entity.property((post) => post.id).hasColumnType("text").isRequired();
      entity.property((post) => post.workspaceId)
        .hasColumnName("workspace_id")
        .hasColumnType("text")
        .isRequired();
      entity.property((post) => post.authorId)
        .hasColumnName("author_id")
        .hasColumnType("text")
        .isRequired();
      entity.property((post) => post.slug).hasColumnType("text").isRequired();
      entity.property((post) => post.title).hasColumnType("text").isRequired();
      entity.property((post) => post.dek).hasColumnType("text").isRequired();
      entity.property((post) => post.body).hasColumnType("text").isRequired();
      entity.property((post) => post.status)
        .hasColumnType("text")
        .hasConversion(enumString<PostStatus>())
        .isRequired();
      entity.property((post) => post.publishedAt)
        .hasColumnName("published_at")
        .hasColumnType("timestamptz")
        .isOptional();
      entity.property((post) => post.createdAt)
        .hasColumnName("created_at")
        .hasColumnType("timestamptz")
        .isRequired();
      entity.property((post) => post.updatedAt)
        .hasColumnName("updated_at")
        .hasColumnType("timestamptz")
        .isRequired();
      entity.hasIndex((post) => [post.workspaceId, post.slug])
        .hasDatabaseName("ux_posts_workspace_slug")
        .isUnique();
      entity.hasIndex((post) => [post.workspaceId, post.status, post.publishedAt])
        .hasDatabaseName("ix_posts_publication");
      entity.hasOne(Workspace, (post) => post.workspace)
        .withMany((workspace) => workspace.posts)
        .hasForeignKey((post) => post.workspaceId)
        .onDelete(DeleteBehavior.Cascade);
      entity.hasOne(Author, (post) => post.author)
        .withMany((author) => author.posts)
        .hasForeignKey((post) => post.authorId)
        .onDelete(DeleteBehavior.NoAction);
      entity.hasManyToMany(Tag, (post) => post.tags)
        .withMany((tag) => tag.posts)
        .usingJoinTable("post_tags", (join) => {
          join.sourceForeignKey("post_id");
          join.targetForeignKey("tag_id");
        });
    });

    model.entity(Tag, (entity) => {
      entity.toTable("tags");
      entity.hasKey((tag) => tag.id);
      entity.property((tag) => tag.id).hasColumnType("text").isRequired();
      entity.property((tag) => tag.workspaceId)
        .hasColumnName("workspace_id")
        .hasColumnType("text")
        .isRequired();
      entity.property((tag) => tag.name).hasColumnType("text").isRequired();
      entity.property((tag) => tag.slug).hasColumnType("text").isRequired();
      entity.hasIndex((tag) => [tag.workspaceId, tag.slug])
        .hasDatabaseName("ux_tags_workspace_slug")
        .isUnique();
    });
  }
}

export class AppDbContext extends PublicationDbContext {
  constructor(private readonly source: PublicationDataSource) {
    super();
  }

  protected override configure(options: DbContextOptionsBuilder): void {
    options.useDataSource(this.source).useAuditing();
  }
}

export class MigrationDbContext extends PublicationDbContext {
  protected override configure(options: DbContextOptionsBuilder): void {
    options.usePostgres(databaseUrl()).useAuditing();
  }
}

import "server-only";

import { withDbContext } from "../data-source";
import { demoIdentity } from "../environment";

export interface WorkspaceView {
  readonly description: string;
  readonly name: string;
  readonly slug: string;
}

export interface PostCardView {
  readonly authorName: string;
  readonly dek: string;
  readonly publishedAt: string;
  readonly slug: string;
  readonly tags: readonly string[];
  readonly title: string;
}

export interface PostDetailView extends PostCardView {
  readonly authorBio: string;
  readonly body: string;
}

export interface PublicationHomeView {
  readonly posts: readonly PostCardView[];
  readonly workspace: WorkspaceView | null;
}

export async function getPublicationHome(
  signal?: AbortSignal,
): Promise<PublicationHomeView> {
  const { workspaceId } = demoIdentity();
  return withDbContext(async (db) => {
    const workspace = await db.workspaces
      .where((candidate) => candidate.id.eq(workspaceId))
      .asNoTracking()
      .singleOrNull({ signal });
    if (!workspace) {
      return { workspace: null, posts: [] };
    }

    const posts = await db.posts
      .where((post) => post.workspaceId.eq(workspaceId)
        .and(post.status.eq("published")))
      .include((post) => post.author)
      .include((post) => post.tags.orderBy((tag) => tag.name))
      .orderByDescending((post) => post.publishedAt)
      .take(12)
      .asNoTracking()
      .toArray({ signal });

    return {
      workspace: {
        description: workspace.description,
        name: workspace.name,
        slug: workspace.slug,
      },
      posts: posts.map(toPostCard),
    };
  });
}

export async function getPublishedPost(
  slug: string,
): Promise<PostDetailView | null> {
  const { workspaceId } = demoIdentity();
  return withDbContext(async (db) => {
    const post = await db.posts
      .where((candidate) => candidate.workspaceId.eq(workspaceId)
        .and(candidate.slug.eq(slug))
        .and(candidate.status.eq("published")))
      .include((candidate) => candidate.author)
      .include((candidate) => candidate.tags.orderBy((tag) => tag.name))
      .asNoTracking()
      .singleOrNull();
    if (!post) {
      return null;
    }
    return {
      ...toPostCard(post),
      authorBio: post.author?.bio ?? "Independent editor",
      body: post.body,
    };
  });
}

function toPostCard(post: {
  readonly author: { readonly displayName: string } | null;
  readonly dek: string;
  readonly publishedAt: Date | null;
  readonly slug: string;
  readonly tags: readonly { readonly name: string }[];
  readonly title: string;
}): PostCardView {
  return {
    authorName: post.author?.displayName ?? "Lantern desk",
    dek: post.dek,
    publishedAt: (post.publishedAt ?? new Date(0)).toISOString(),
    slug: post.slug,
    tags: post.tags.map((tag) => tag.name),
    title: post.title,
  };
}

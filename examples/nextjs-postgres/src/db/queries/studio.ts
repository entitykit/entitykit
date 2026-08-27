import "server-only";

import { demoIdentity } from "../environment";
import { withDbContext } from "../data-source";

export interface StudioPostView {
  readonly id: string;
  readonly status: "draft" | "published";
  readonly title: string;
  readonly updatedAt: string;
}

export interface StudioView {
  readonly draftCount: number;
  readonly posts: readonly StudioPostView[];
  readonly publishedCount: number;
}

export async function getStudio(): Promise<StudioView> {
  const { workspaceId } = demoIdentity();
  return withDbContext(async (db) => {
    const posts = await db.posts
      .where((post) => post.workspaceId.eq(workspaceId))
      .orderByDescending((post) => post.updatedAt)
      .asNoTracking()
      .toArray();
    const views = posts.map((post) => ({
      id: post.id,
      status: post.status,
      title: post.title,
      updatedAt: post.updatedAt.toISOString(),
    }));
    return {
      draftCount: views.filter((post) => post.status === "draft").length,
      posts: views,
      publishedCount: views.filter((post) => post.status === "published").length,
    };
  });
}

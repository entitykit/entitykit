import type { Author } from "./author";
import type { Tag } from "./tag";
import type { Workspace } from "./workspace";

export type PostStatus = "draft" | "published";

export class Post {
  id = "";
  workspaceId = "";
  authorId = "";
  slug = "";
  title = "";
  dek = "";
  body = "";
  status: PostStatus = "draft";
  publishedAt: Date | null = null;
  createdAt = new Date(0);
  updatedAt = new Date(0);
  workspace: Workspace | null = null;
  author: Author | null = null;
  tags: Tag[] = [];

  constructor(values?: Partial<Post>) {
    Object.assign(this, values);
  }
}

import type { Post } from "./post";

export class Tag {
  id = "";
  workspaceId = "";
  name = "";
  slug = "";
  posts: Post[] = [];

  constructor(values?: Partial<Tag>) {
    Object.assign(this, values);
  }
}

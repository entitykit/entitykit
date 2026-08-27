import type { Post } from "./post";

export class Workspace {
  id = "";
  slug = "";
  name = "";
  description = "";
  createdAt = new Date(0);
  posts: Post[] = [];

  constructor(values?: Partial<Workspace>) {
    Object.assign(this, values);
  }
}

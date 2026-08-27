import type { Post } from "./post";

export class Author {
  id = "";
  displayName = "";
  bio = "";
  createdAt = new Date(0);
  posts: Post[] = [];

  constructor(values?: Partial<Author>) {
    Object.assign(this, values);
  }
}

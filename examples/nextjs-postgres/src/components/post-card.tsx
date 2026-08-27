import Link from "next/link";
import type { PostCardView } from "@/db/queries/publication";

export function PostCard({ post }: { readonly post: PostCardView }): React.JSX.Element {
  return (
    <article className="post-card">
      <div className="post-card-rule" aria-hidden="true" />
      <p className="eyebrow">
        {formatDate(post.publishedAt)} · {post.authorName}
      </p>
      <h2>
        <Link href={`/posts/${post.slug}`}>{post.title}</Link>
      </h2>
      <p className="post-dek">{post.dek}</p>
      <div className="tag-list" aria-label="Topics">
        {post.tags.map((tag) => <span key={tag}>{tag}</span>)}
      </div>
      <Link className="text-link" href={`/posts/${post.slug}`}>
        Read essay <span aria-hidden="true">↗</span>
      </Link>
    </article>
  );
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

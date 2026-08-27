import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { formatDate } from "@/components/post-card";
import { getPublishedPost } from "@/db/queries/publication";

export const metadata = { title: "Dispatch" };
export const runtime = "nodejs";

interface PostPageProps {
  readonly params: Promise<{ slug: string }>;
}

export default async function PostPage({ params }: PostPageProps): Promise<React.JSX.Element> {
  await connection();
  const { slug } = await params;
  const post = await getPublishedPost(slug);
  if (!post) {
    notFound();
  }

  return (
    <article className="article shell-narrow">
      <Link className="back-link" href="/">← Journal</Link>
      <header>
        <p className="eyebrow">{formatDate(post.publishedAt)} · {post.authorName}</p>
        <h1>{post.title}</h1>
        <p className="article-dek">{post.dek}</p>
        <div className="tag-list">
          {post.tags.map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      </header>
      <div className="article-body">
        {post.body.split("\n\n").map((paragraph) => (
          <p key={paragraph.slice(0, 48)}>{paragraph}</p>
        ))}
      </div>
      <footer className="author-note">
        <span className="author-monogram">{post.authorName.slice(0, 1)}</span>
        <div>
          <strong>{post.authorName}</strong>
          <p>{post.authorBio}</p>
        </div>
      </footer>
    </article>
  );
}

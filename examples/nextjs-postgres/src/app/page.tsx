import { connection } from "next/server";
import { PostCard } from "@/components/post-card";
import { getPublicationHome } from "@/db/queries/publication";

export const runtime = "nodejs";

export default async function HomePage(): Promise<React.JSX.Element> {
  await connection();
  const publication = await getPublicationHome();

  return (
    <>
      <section className="hero shell">
        <p className="eyebrow">Independent notes on software and craft</p>
        <h1>{publication.workspace?.name ?? "Lantern Journal"}</h1>
        <p className="hero-copy">
          {publication.workspace?.description
            ?? "Run the checked-in migration to open the publication."}
        </p>
        <div className="hero-meta">
          <span>{String(publication.posts.length).padStart(2, "0")} dispatches</span>
          <span>Published from a short-lived DbContext</span>
        </div>
      </section>

      <section className="issue shell" aria-labelledby="latest-heading">
        <div className="section-heading">
          <p className="eyebrow">Current issue</p>
          <h2 id="latest-heading">Ideas worth keeping</h2>
        </div>
        {publication.posts.length > 0 ? (
          <div className="post-grid">
            {publication.posts.map((post) => <PostCard key={post.slug} post={post} />)}
          </div>
        ) : (
          <div className="empty-state">
            <p>No published essays yet.</p>
            <p>Open Studio to draft the first one.</p>
          </div>
        )}
      </section>
    </>
  );
}

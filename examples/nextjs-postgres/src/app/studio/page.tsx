import { connection } from "next/server";
import { StudioRow } from "@/components/studio-row";
import { getStudio } from "@/db/queries/studio";
import { createDraft } from "./actions";

export const metadata = { title: "Studio" };
export const runtime = "nodejs";

interface StudioPageProps {
  readonly searchParams: Promise<{ created?: string }>;
}

export default async function StudioPage({
  searchParams,
}: StudioPageProps): Promise<React.JSX.Element> {
  await connection();
  const [studio, query] = await Promise.all([getStudio(), searchParams]);

  return (
    <div className="studio shell">
      <header className="studio-header">
        <div>
          <p className="eyebrow">Editorial room</p>
          <h1>Shape the next dispatch.</h1>
        </div>
        <div className="studio-stats" aria-label="Post counts">
          <span><strong>{studio.draftCount}</strong> drafts</span>
          <span><strong>{studio.publishedCount}</strong> published</span>
        </div>
      </header>

      {query.created ? (
        <p className="notice" role="status">Draft saved. It is ready in the queue.</p>
      ) : null}

      <aside className="boundary-note">
        <strong>Demo boundary</strong>
        <p>This studio is intentionally open. Add authentication and server-side
          authorization before deploying it beyond a private evaluation environment.</p>
      </aside>

      <div className="studio-grid">
        <section className="composer" aria-labelledby="composer-heading">
          <p className="eyebrow">New draft</p>
          <h2 id="composer-heading">Begin with a clear idea.</h2>
          <form action={createDraft}>
            <label>
              Title
              <input name="title" maxLength={100} required placeholder="A durable point of view" />
            </label>
            <label>
              Deck
              <textarea name="dek" maxLength={220} required rows={3}
                placeholder="One sentence that earns the next minute." />
            </label>
            <label>
              Essay
              <textarea name="body" maxLength={8000} required rows={11}
                placeholder="Write with room to breathe. Separate paragraphs with a blank line." />
            </label>
            <button className="button" type="submit">Save draft</button>
          </form>
        </section>

        <section className="queue" aria-labelledby="queue-heading">
          <p className="eyebrow">Publication queue</p>
          <h2 id="queue-heading">Recent work</h2>
          <ul>
            {studio.posts.map((post) => <StudioRow key={post.id} post={post} />)}
          </ul>
        </section>
      </div>
    </div>
  );
}

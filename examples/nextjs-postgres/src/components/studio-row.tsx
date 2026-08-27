import { publishPost } from "@/app/studio/actions";
import type { StudioPostView } from "@/db/queries/studio";

export function StudioRow({ post }: { readonly post: StudioPostView }): React.JSX.Element {
  return (
    <li className="studio-row">
      <div>
        <span className={`status status-${post.status}`}>{post.status}</span>
        <h3>{post.title}</h3>
        <p>Edited {formatRelativeDate(post.updatedAt)}</p>
      </div>
      {post.status === "draft" ? (
        <form action={publishPost}>
          <input name="id" type="hidden" value={post.id} />
          <button className="button button-small" type="submit">Publish</button>
        </form>
      ) : <span className="published-check" aria-label="Published">✓</span>}
    </li>
  );
}

function formatRelativeDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

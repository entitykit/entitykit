import Link from "next/link";

export default function NotFound(): React.JSX.Element {
  return (
    <section className="error-state shell-narrow">
      <p className="eyebrow">404 · Missing page</p>
      <h1>This dispatch left no forwarding address.</h1>
      <p>The essay may still be a draft, or its address may have changed.</p>
      <Link className="button" href="/">Return to the journal</Link>
    </section>
  );
}

"use client";

export default function ErrorPage({
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>): React.JSX.Element {
  return (
    <section className="error-state shell-narrow">
      <p className="eyebrow">The press paused</p>
      <h1>We could not reach the journal.</h1>
      <p>Check the database connection and migration status, then try again.</p>
      <button className="button" onClick={reset} type="button">Try again</button>
    </section>
  );
}

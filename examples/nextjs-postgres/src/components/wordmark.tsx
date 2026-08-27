import Link from "next/link";

export function Wordmark(): React.JSX.Element {
  return (
    <Link className="wordmark" href="/" aria-label="Lantern Journal home">
      <span className="wordmark-mark" aria-hidden="true">L</span>
      <span>Lantern Journal</span>
    </Link>
  );
}

import "server-only";

import { createPostgresDataSource } from "@entitykit/postgres";
import { databaseUrl } from "./environment";
import {
  AppDbContext,
  type PublicationDataSource,
} from "./publication-db-context";

declare global {
  // `var` is intentional: it keeps one pool across Next.js server runtime graphs
  // and development reloads within the same Node.js process.
  var entityKitNextDemoSource: PublicationDataSource | undefined;
}

export function getDataSource(): PublicationDataSource {
  const existing = globalThis.entityKitNextDemoSource;
  if (existing) {
    return existing;
  }

  const source = createPostgresDataSource({
    connectionString: databaseUrl(),
    applicationName: "entitykit-nextjs-demo",
    pool: {
      max: 5,
      idleTimeoutMs: 30_000,
      connectionTimeoutMs: 5_000,
      allowExitOnIdle: true,
    },
  });

  globalThis.entityKitNextDemoSource = source;
  return source;
}

export async function withDbContext<TResult>(
  work: (db: AppDbContext) => TResult | Promise<TResult>,
): Promise<TResult> {
  const db = getDataSource().createContext(AppDbContext);
  try {
    return await work(db);
  } finally {
    await db.dispose();
  }
}

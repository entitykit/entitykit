export interface DemoIdentity {
  readonly authorId: string;
  readonly workspaceId: string;
  readonly workspaceSlug: string;
}

export function databaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) {
    throw new Error(
      "DATABASE_URL is required at request time. Copy .env.example to .env.local.",
    );
  }
  return value;
}

export function demoIdentity(): DemoIdentity {
  return {
    authorId: process.env.DEMO_AUTHOR_ID?.trim() || "usr_mara",
    workspaceId: process.env.DEMO_WORKSPACE_ID?.trim() || "wrk_lantern",
    workspaceSlug: process.env.DEMO_WORKSPACE_SLUG?.trim() || "lantern",
  };
}

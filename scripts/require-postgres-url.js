const databaseUrl = process.env.DATABASE_URL;

if (typeof databaseUrl !== "string" || databaseUrl.trim().length === 0) {
  console.error("DATABASE_URL is required to run live Postgres integration tests.");
  console.error("Example: DATABASE_URL=postgres://postgres:postgres@localhost:5432/entitykit npm run test:integration");
  process.exit(1);
}

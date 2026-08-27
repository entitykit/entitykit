import type { NextRequest } from "next/server";
import { getPublicationHome } from "@/db/queries/publication";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<Response> {
  const publication = await getPublicationHome(request.signal);
  return Response.json({
    data: publication.posts,
    meta: {
      count: publication.posts.length,
      publication: publication.workspace?.name ?? null,
    },
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}

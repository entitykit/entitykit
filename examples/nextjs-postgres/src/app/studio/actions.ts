"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withDbContext } from "@/db/data-source";
import { demoIdentity } from "@/db/environment";
import { Post } from "@/db/model/post";

export async function createDraft(formData: FormData): Promise<void> {
  const title = requiredText(formData, "title", 100);
  const dek = requiredText(formData, "dek", 220);
  const body = requiredText(formData, "body", 8_000);
  const identity = demoIdentity();
  const now = new Date();
  const slug = `${toSlug(title)}-${randomUUID().slice(0, 6)}`;

  await withDbContext(async (db) => {
    db.posts.add(new Post({
      id: `post_${randomUUID()}`,
      workspaceId: identity.workspaceId,
      authorId: identity.authorId,
      slug,
      title,
      dek,
      body,
      status: "draft",
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
    }));
    await db.saveChanges();
  });

  revalidatePath("/studio");
  redirect(`/studio?created=${encodeURIComponent(slug)}`);
}

export async function publishPost(formData: FormData): Promise<void> {
  const id = requiredText(formData, "id", 80);
  const { workspaceId } = demoIdentity();

  await withDbContext(async (db) => {
    const post = await db.posts
      .where((candidate) => candidate.id.eq(id)
        .and(candidate.workspaceId.eq(workspaceId)))
      .singleOrNull();
    if (!post) {
      throw new Error("The selected post is unavailable.");
    }
    if (post.status === "published") {
      return;
    }
    const now = new Date();
    post.status = "published";
    post.publishedAt = now;
    post.updatedAt = now;
    await db.saveChanges();
  });

  revalidatePath("/");
  revalidatePath("/studio");
}

function requiredText(formData: FormData, field: string, maxLength: number): string {
  const value = formData.get(field);
  if (typeof value !== "string") {
    throw new Error(`${field} must be text.`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${field} must contain 1 to ${String(maxLength)} characters.`);
  }
  return normalized;
}

function toSlug(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 64);
  return slug || "untitled";
}

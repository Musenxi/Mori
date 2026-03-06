import { notFound } from "next/navigation";
import { Suspense } from "react";

import "../../article-content-critical.css";
import { StaticPageContentFallback } from "@/components/page-loading-fallbacks";
import { StaticPageContent } from "@/components/static-page-view";
import { getStaticPageDetailBySlug } from "@/lib/site-data";
import { getPages } from "@/lib/typecho-client";

export const revalidate = 60;
const RESERVED_PAGE_SLUGS = new Set(["about", "comment", "friends", "category", "column", "message"]);

interface GenericPageProps {
  params: Promise<{
    slug: string;
  }>;
}

export async function generateStaticParams() {
  try {
    const pages = await getPages();
    return pages
      .map((page) => String(page.slug || "").trim())
      .filter((slug) => slug.length > 0 && !RESERVED_PAGE_SLUGS.has(slug.toLowerCase()))
      .map((slug) => ({ slug }));
  } catch {
    return [] as Array<{ slug: string }>;
  }
}

async function GenericPageContent({
  slug,
}: {
  slug: string;
}) {
  const detail = await getStaticPageDetailBySlug(slug, 1);
  if (!detail) {
    notFound();
  }

  return (
    <StaticPageContent
      fallbackTitle={detail.page.title}
      page={detail.page}
      comments={detail.comments}
      commentsPagination={detail.commentsPagination}
    />
  );
}

export default async function GenericPage({ params }: GenericPageProps) {
  const { slug } = await params;

  return (
    <Suspense fallback={<StaticPageContentFallback />}>
      <GenericPageContent slug={slug} />
    </Suspense>
  );
}

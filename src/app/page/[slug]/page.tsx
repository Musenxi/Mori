import { notFound } from "next/navigation";
import { Suspense } from "react";

import "../../article-content-critical.css";
import { StaticPageContentFallback } from "@/components/page-loading-fallbacks";
import { Shell } from "@/components/shell";
import { StaticPageContent } from "@/components/static-page-view";
import { buildNavItems } from "@/lib/navigation";
import { getSiteContext, getStaticPageDetailBySlug } from "@/lib/site-data";

export const revalidate = 60;

interface GenericPageProps {
  params: Promise<{
    slug: string;
  }>;
  searchParams: Promise<{
    cpage?: string;
  }>;
}

function parseCommentPage(value?: string) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

async function GenericPageContent({
  slug,
  commentPage,
  configured,
}: {
  slug: string;
  commentPage: number;
  configured: boolean;
}) {
  if (!configured) {
    return <StaticPageContent fallbackTitle={slug} page={null} />;
  }
  const detail = await getStaticPageDetailBySlug(slug, commentPage);
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

export default async function GenericPage({ params, searchParams }: GenericPageProps) {
  const { slug } = await params;
  const commentPage = parseCommentPage((await searchParams).cpage);
  const context = await getSiteContext();
  const navItems = buildNavItems(context);

  return (
    <Shell context={context} navItems={navItems}>
      <Suspense fallback={<StaticPageContentFallback />}>
        <GenericPageContent
          slug={slug}
          commentPage={commentPage}
          configured={context.configured}
        />
      </Suspense>
    </Shell>
  );
}

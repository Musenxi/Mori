import { notFound } from "next/navigation";

import { StaticPageView } from "@/components/static-page-view";
import { buildNavItems } from "@/lib/navigation";
import { getSiteContext, getStaticPageDetailBySlug } from "@/lib/site-data";

export const dynamic = "force-dynamic";

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

export default async function GenericPage({ params, searchParams }: GenericPageProps) {
  const { slug } = await params;
  const commentPage = parseCommentPage((await searchParams).cpage);

  const context = await getSiteContext();
  const navItems = buildNavItems(context);

  if (!context.configured) {
    return <StaticPageView context={context} navItems={navItems} fallbackTitle={slug} page={null} />;
  }

  const detail = await getStaticPageDetailBySlug(slug, commentPage);
  if (!detail) {
    notFound();
  }

  return (
    <StaticPageView
      context={context}
      navItems={navItems}
      fallbackTitle={detail.page.title}
      page={detail.page}
      comments={detail.comments}
      commentsPagination={detail.commentsPagination}
    />
  );
}

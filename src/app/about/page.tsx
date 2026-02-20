import { StaticPageView } from "@/components/static-page-view";
import { buildNavItems } from "@/lib/navigation";
import { getSiteContext, getStaticPageDetailBySlug } from "@/lib/site-data";

export const dynamic = "force-dynamic";

interface AboutPageProps {
  searchParams: Promise<{
    cpage?: string;
  }>;
}

function parseCommentPage(value?: string) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export default async function AboutPage({ searchParams }: AboutPageProps) {
  const commentPage = parseCommentPage((await searchParams).cpage);
  const context = await getSiteContext();
  const navItems = buildNavItems(context);

  const detail = context.configured ? await getStaticPageDetailBySlug("about", commentPage) : null;

  return (
    <StaticPageView
      context={context}
      navItems={navItems}
      fallbackTitle="关于"
      page={detail?.page ?? null}
      comments={detail?.comments ?? []}
      commentsPagination={detail?.commentsPagination}
    />
  );
}

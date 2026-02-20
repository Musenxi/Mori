import { StaticPageView } from "@/components/static-page-view";
import { buildNavItems } from "@/lib/navigation";
import { getSiteContext, getStaticPageDetailBySlug } from "@/lib/site-data";

export const dynamic = "force-dynamic";

interface CommentPageProps {
  searchParams: Promise<{
    cpage?: string;
  }>;
}

function parseCommentPage(value?: string) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export default async function CommentPage({ searchParams }: CommentPageProps) {
  const commentPage = parseCommentPage((await searchParams).cpage);
  const context = await getSiteContext();
  const navItems = buildNavItems(context);

  const detail = context.configured ? await getStaticPageDetailBySlug("comment", commentPage) : null;

  return (
    <StaticPageView
      context={context}
      navItems={navItems}
      fallbackTitle="留言"
      page={detail?.page ?? null}
      comments={detail?.comments ?? []}
      commentsPagination={detail?.commentsPagination}
    />
  );
}

import { StaticPageView } from "@/components/static-page-view";
import { buildNavItems } from "@/lib/navigation";
import { getSiteContext, getStaticPageDetailBySlug } from "@/lib/site-data";

export const dynamic = "force-dynamic";

interface FriendsPageProps {
  searchParams: Promise<{
    cpage?: string;
  }>;
}

function parseCommentPage(value?: string) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export default async function FriendsPage({ searchParams }: FriendsPageProps) {
  const commentPage = parseCommentPage((await searchParams).cpage);
  const context = await getSiteContext();
  const navItems = buildNavItems(context);

  const detail = context.configured ? await getStaticPageDetailBySlug("friends", commentPage) : null;

  return (
    <StaticPageView
      context={context}
      navItems={navItems}
      fallbackTitle="友人"
      page={detail?.page ?? null}
      comments={detail?.comments ?? []}
      commentsPagination={detail?.commentsPagination}
    />
  );
}

import { CommentSection } from "@/components/article/comment-section";
import { Shell } from "@/components/shell";
import { CommentPagination, NormalizedComment, NormalizedPost } from "@/lib/typecho-types";
import { SiteContext } from "@/lib/site-data";

interface StaticPageViewProps {
  context: SiteContext;
  navItems: Array<{ href: string; label: string }>;
  fallbackTitle: string;
  page: NormalizedPost | null;
  comments?: NormalizedComment[];
  commentsPagination?: CommentPagination;
}

interface StaticPageContentProps {
  fallbackTitle: string;
  page: NormalizedPost | null;
  comments?: NormalizedComment[];
  commentsPagination?: CommentPagination;
}

export function StaticPageContent({
  fallbackTitle,
  page,
  comments = [],
  commentsPagination,
}: StaticPageContentProps) {
  return (
    <main className="mx-auto w-full max-w-[1440px] px-5 pb-10 md:px-0">
      <section className="mx-auto max-w-[850px] py-10 md:py-[100px]">
        <h1 className="mori-stagger-item font-serif-cn text-[32px] leading-[1.4] tracking-[4px] text-primary md:text-[42px]">
          {page?.title || fallbackTitle}
        </h1>

        <div className="mori-stagger-item mt-8 h-px w-full bg-border" style={{ animationDelay: "60ms" }} />

        {page?.html ? (
          <div
            className="mori-stagger-item prose-article mt-8"
            style={{ animationDelay: "90ms" }}
            dangerouslySetInnerHTML={{ __html: page.html }}
          />
        ) : (
          <p className="mori-stagger-item mt-8 font-sans text-sm leading-8 text-secondary" style={{ animationDelay: "90ms" }}>
            该页面暂无内容。
          </p>
        )}

        {page && page.commentValue !== 0 ? (
          <section className="mori-stagger-item mt-12" style={{ animationDelay: "140ms" }}>
            <CommentSection
              slug={page.slug}
              comments={comments}
              disableForm={page.commentValue === 2}
              pagination={commentsPagination}
            />
          </section>
        ) : null}
      </section>
    </main>
  );
}

export function StaticPageView({
  context,
  navItems,
  fallbackTitle,
  page,
  comments,
  commentsPagination,
}: StaticPageViewProps) {
  return (
    <Shell context={context} navItems={navItems}>
      <StaticPageContent
        fallbackTitle={fallbackTitle}
        page={page}
        comments={comments}
        commentsPagination={commentsPagination}
      />
    </Shell>
  );
}

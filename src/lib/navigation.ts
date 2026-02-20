import { SiteContext } from "@/lib/site-data";

function hasPage(context: SiteContext, slug: string) {
  return context.pages.some((page) => page.slug.toLowerCase() === slug.toLowerCase());
}

export function buildNavItems(context: SiteContext) {
  const nav: Array<{ href: string; label: string }> = [{ href: "/", label: "首页" }];

  if (hasPage(context, "category")) {
    nav.push({ href: "/category", label: "分类" });
  }

  if (hasPage(context, "comment")) {
    nav.push({ href: "/comment", label: "留言" });
  }

  if (hasPage(context, "friends")) {
    nav.push({ href: "/friends", label: "友人" });
  }

  if (hasPage(context, "about")) {
    nav.push({ href: "/about", label: "关于" });
  }

  const reserved = new Set(["category", "comment", "friends", "about", "message"]);
  const extraPages = context.pages.filter((page) => !reserved.has(page.slug.toLowerCase()));

  extraPages.forEach((page) => {
    nav.push({
      href: `/page/${encodeURIComponent(page.slug)}`,
      label: page.title,
    });
  });

  return nav;
}

import { SiteContext } from "@/lib/site-data";

function getPage(context: SiteContext, slug: string) {
  return context.pages.find((page) => page.slug.toLowerCase() === slug.toLowerCase());
}

export function buildNavItems(context: SiteContext) {
  const nav: Array<{ href: string; label: string }> = [{ href: "/", label: "首页" }];

  const categoryPage = getPage(context, "category");
  if (categoryPage) {
    nav.push({ href: categoryPage.redirect || "/category", label: "分类" });
  }

  const commentPage = getPage(context, "comment");
  if (commentPage) {
    nav.push({ href: commentPage.redirect || "/comment", label: "留言" });
  }

  const friendsPage = getPage(context, "friends");
  if (friendsPage) {
    nav.push({ href: friendsPage.redirect || "/friends", label: "友人" });
  }

  const aboutPage = getPage(context, "about");
  if (aboutPage) {
    nav.push({ href: aboutPage.redirect || "/about", label: "关于" });
  }

  const reserved = new Set(["category", "comment", "friends", "about", "message"]);
  const extraPages = context.pages.filter((page) => !reserved.has(page.slug.toLowerCase()));

  extraPages.forEach((page) => {
    nav.push({
      href: page.redirect || `/page/${encodeURIComponent(page.slug)}`,
      label: page.title,
    });
  });

  return nav;
}

import { ReactNode } from "react";

import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { NoConfigAlert } from "@/components/no-config-alert";
import { SiteContext } from "@/lib/site-data";

interface ShellProps {
  context: SiteContext;
  navItems: Array<{ href: string; label: string }>;
  children: ReactNode;
  mobileArticleMode?: boolean;
}

export function Shell({ context, navItems, children, mobileArticleMode = false }: ShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-primary">
      <SiteHeader blogTitle={context.blogTitle} navItems={navItems} mobileArticleMode={mobileArticleMode} />
      {!context.configured ? <NoConfigAlert /> : null}
      <div className="flex-1">{children}</div>
      <SiteFooter blogTitle={context.blogTitle} />
    </div>
  );
}

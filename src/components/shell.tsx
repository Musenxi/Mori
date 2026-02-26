import { ReactNode } from "react";

import { MarkdownRuntimeLazy } from "@/components/markdown-runtime-lazy";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { NoConfigAlert } from "@/components/no-config-alert";
import { SiteContext } from "@/lib/site-data";

interface ShellProps {
  context: SiteContext;
  navItems: Array<{ href: string; label: string }>;
  children: ReactNode;
}

export function Shell({ context, navItems, children }: ShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-primary">
      <SiteHeader blogTitle={context.blogTitle} navItems={navItems} />
      {!context.configured ? <NoConfigAlert /> : null}
      <div className="mori-view-transition-region flex-1">{children}</div>
      <MarkdownRuntimeLazy />
      <SiteFooter blogTitle={context.blogTitle} />
    </div>
  );
}

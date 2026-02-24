import { SiteFooterPresence } from "@/components/site-footer-presence";

interface SiteFooterProps {
  blogTitle: string;
}

export function SiteFooter({ blogTitle }: SiteFooterProps) {
  const year = new Date().getFullYear();

  return (
    <footer className="flex h-[100px] items-center justify-center px-5 md:px-20">
      <p className="font-sans text-[13px] font-light tracking-[0.5px] text-primary/60">
        © 2019-{year} {blogTitle} · <SiteFooterPresence />
      </p>
    </footer>
  );
}

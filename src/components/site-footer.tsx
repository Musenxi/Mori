"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SiteFooterPresence } from "@/components/site-footer-presence";

interface SiteFooterProps {
  blogTitle: string;
}

export function SiteFooter({ blogTitle }: SiteFooterProps) {
  const year = new Date().getFullYear();
  const pathname = usePathname();
  const [show, setShow] = useState(false);
  const [prevPath, setPrevPath] = useState(pathname);

  if (pathname !== prevPath) {
    setPrevPath(pathname);
    setShow(false);
  }

  useEffect(() => {
    if (!show) {
      const timer = setTimeout(() => {
        setShow(true);
      }, 450);
      return () => clearTimeout(timer);
    }
  }, [pathname, show]);

  const isPost = pathname.startsWith("/post/");
  const isHome = pathname === "/" || pathname.startsWith("/category") || pathname.startsWith("/column");

  let alignClass = "mx-auto w-full max-w-[850px] px-5 md:px-[calc(50vw-425px)]";
  if (isPost) {
    alignClass =
      "w-full px-5 md:pl-[calc(50vw-425px)] min-[1080px]:max-[1439px]:pl-[calc(50vw-549px)] min-[1440px]:pl-[calc(50vw-445px)]";
  } else if (isHome) {
    alignClass =
      "w-full px-5 md:pl-[clamp(100px,calc(40vw-200px),380px)]";
  }

  return (
    <footer
      className={`mori-site-footer flex flex-col items-start pt-3 pb-8 transition-opacity duration-700 ease-out ${show ? "opacity-100" : "opacity-0 pointer-events-none"
        } ${alignClass}`}
    >
      <div className="flex flex-col gap-2 font-[system-ui,-apple-system,sans-serif] text-[13px] text-primary">
        <p>
          © 2019-{year}{" "}
          <Link href="/" className="transition-opacity hover:opacity-70">
            {blogTitle}
          </Link>
          <span className="mx-1.5 opacity-50">|</span>
          <Link href="/feed" className="transition-opacity hover:opacity-70" prefetch={false}>
            RSS
          </Link>
          <span className="mx-1.5 opacity-50">|</span>
          <a
            href="https://www.travellings.cn/go"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-opacity hover:opacity-70"
          >
            开往
          </a>
        </p>
        <p>
          Powered by{" "}
          <a
            href="https://github.com/Musenxi/Mori"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-opacity hover:opacity-70"
          >
            Mori
          </a>
          <span className="mx-1.5 opacity-50">|</span>
          <SiteFooterPresence />
        </p>
      </div>
    </footer>
  );
}

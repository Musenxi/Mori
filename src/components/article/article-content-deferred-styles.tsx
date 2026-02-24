"use client";

import { useEffect } from "react";

const ARTICLE_STYLE_SELECTOR = 'link[data-mori-article-style="full"]';
const ARTICLE_STYLE_HREF = "/styles/article-content.css";

function ensureDeferredArticleStyle() {
  if (document.querySelector(ARTICLE_STYLE_SELECTOR)) {
    return;
  }

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = ARTICLE_STYLE_HREF;
  link.media = "print";
  link.setAttribute("data-mori-article-style", "full");
  link.onload = () => {
    link.media = "all";
  };
  document.head.appendChild(link);
}

export function ArticleContentDeferredStyles() {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      ensureDeferredArticleStyle();
    }, 120);

    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  return null;
}

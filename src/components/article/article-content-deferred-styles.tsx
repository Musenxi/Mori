const ARTICLE_STYLE_HREF = "/styles/article-content.css";

export function ArticleContentDeferredStyles() {
  return <link rel="stylesheet" href={ARTICLE_STYLE_HREF} precedence="default" />;
}

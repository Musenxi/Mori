import {
  getArchives,
  getCategories,
  getComments,
  getPages,
  getPostBySlug,
  getPosts,
  getSettings,
  isTypechoConfigured,
} from "./typecho-client";
import {
  flattenArchives,
  groupPostsByYear,
  limitCommentDepth,
  normalizeCommentTree,
  normalizePost,
  normalizePosts,
  stripHtml,
} from "./typecho-normalize";
import { prepareArticleContent } from "./article-content";
import {
  CommentPagination,
  NormalizedPost,
  TocItem,
  TypechoCategory,
  TypechoCommentsResponse,
} from "./typecho-types";

export interface SiteContext {
  blogTitle: string;
  blogDescription: string;
  keywords: string;
  configured: boolean;
  pages: Array<{ cid: number; slug: string; title: string }>;
}

export interface ColumnInfo {
  slug: string;
  name: string;
  description: string;
  count: number;
  icon?: string;
}

const DEFAULT_COMMENT_PAGE_SIZE = 10;
const COMMENT_CACHE_SECONDS = 5;

function mapCategoryToColumn(category: TypechoCategory): ColumnInfo {
  return {
    slug: String(category.slug),
    name: String(category.name),
    description: typeof category.description === "string" ? category.description : "",
    count: Number(category.count ?? 0),
  };
}

function parseColumnDescription(rawDescription: unknown) {
  const text = typeof rawDescription === "string" ? rawDescription.trim() : "";
  if (!text) {
    return {
      icon: "",
      description: "",
    };
  }

  const pairMatch = text.match(/^\s*\[([^\]]*)\]\s*\[([\s\S]*)\]\s*$/);
  if (!pairMatch) {
    return {
      icon: "",
      description: text,
    };
  }

  return {
    icon: pairMatch[1]?.trim() ?? "",
    description: pairMatch[2]?.trim() ?? "",
  };
}

function stripAndSlice(text: string, fallback: string) {
  const compact = text.trim();
  if (compact.length > 0) {
    return compact;
  }
  return fallback;
}

function normalizeCategorySlug(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function collectCategoryTreeSlugs(category: TypechoCategory, bucket: Set<string>) {
  const slug = normalizeCategorySlug(category.slug);
  if (slug) {
    bucket.add(slug);
  }

  const children = Array.isArray(category.children) ? category.children : [];
  children.forEach((child) => {
    collectCategoryTreeSlugs(child, bucket);
  });
}

function getExcludedCategorySlugs(categories: TypechoCategory[]) {
  const excluded = new Set<string>();
  const columnParent = categories.find((item) => normalizeCategorySlug(item.slug) === "column");
  if (!columnParent) {
    return excluded;
  }

  collectCategoryTreeSlugs(columnParent, excluded);
  excluded.add("column");

  const columnParentMid = Number(columnParent.mid);
  if (!Number.isFinite(columnParentMid)) {
    return excluded;
  }

  const excludedMids = new Set<number>([columnParentMid]);
  let changed = true;

  while (changed) {
    changed = false;

    categories.forEach((item) => {
      const mid = Number(item.mid);
      const parent = Number(item.parent ?? 0);
      if (!Number.isFinite(mid) || !Number.isFinite(parent)) {
        return;
      }

      if (excludedMids.has(parent) && !excludedMids.has(mid)) {
        excludedMids.add(mid);
        changed = true;
      }
    });
  }

  categories.forEach((item) => {
    const mid = Number(item.mid);
    if (!Number.isFinite(mid) || !excludedMids.has(mid)) {
      return;
    }

    const slug = normalizeCategorySlug(item.slug);
    if (slug) {
      excluded.add(slug);
    }
  });

  return excluded;
}

function getChildrenOfColumnParent(categories: TypechoCategory[], parent: TypechoCategory) {
  const children = Array.isArray(parent.children) ? parent.children : [];
  if (children.length > 0) {
    return children;
  }

  const parentMid = Number(parent.mid);
  if (!Number.isFinite(parentMid)) {
    return [] as TypechoCategory[];
  }

  return categories.filter((item) => Number(item.parent ?? 0) === parentMid);
}

function buildColumnsFromColumnCategory(categories: TypechoCategory[], posts: NormalizedPost[]) {
  const columnParent = categories.find((item) => String(item.slug || "").trim().toLowerCase() === "column");
  if (!columnParent) {
    return [] as ColumnInfo[];
  }

  const usageCount = new Map<string, number>();
  posts.forEach((post) => {
    const key = (post.seriesSlug || "").trim();
    if (!key) {
      return;
    }
    usageCount.set(key, (usageCount.get(key) ?? 0) + 1);
  });

  const children = getChildrenOfColumnParent(categories, columnParent)
    .filter((item) => item.slug && item.name)
    .map((item) => {
      const slug = String(item.slug).trim();
      const name = String(item.name).trim() || slug;
      const parsed = parseColumnDescription(item.description);
      const countFromPosts = usageCount.get(slug);

      return {
        slug,
        name,
        description: parsed.description,
        count: countFromPosts ?? Number(item.count ?? 0),
        icon: parsed.icon || undefined,
      } satisfies ColumnInfo;
    });

  return children.sort((a, b) => {
    if (a.count !== b.count) {
      return b.count - a.count;
    }
    return a.name.localeCompare(b.name, "zh-CN");
  });
}

async function getAllPostsForListing() {
  try {
    const archives = await getArchives({
      showDigest: "excerpt",
      limit: 92,
      showContent: true,
      order: "desc",
    });

    return flattenArchives(archives);
  } catch {
    const fallback = await getPosts({
      page: 1,
      pageSize: 120,
      showDigest: "excerpt",
      limit: 92,
      showContent: true,
    });

    return normalizePosts(fallback.dataSet);
  }
}

export async function getSiteContext(): Promise<SiteContext> {
  if (!isTypechoConfigured()) {
    return {
      blogTitle: "夜庭記",
      blogDescription: "Typecho Restful API 未配置",
      keywords: "",
      configured: false,
      pages: [],
    };
  }

  try {
    const [settings, pages] = await Promise.all([getSettings(), getPages()]);

    return {
      blogTitle: stripAndSlice(settings.title ?? "", "夜庭記"),
      blogDescription: stripAndSlice(settings.description ?? "", "静观其变，慢写人间。"),
      keywords: settings.keywords ?? "",
      configured: true,
      pages: pages.map((page) => ({
        cid: page.cid,
        slug: page.slug,
        title: page.title,
      })),
    };
  } catch {
    return {
      blogTitle: "夜庭記",
      blogDescription: "Typecho Restful API 请求失败",
      keywords: "",
      configured: false,
      pages: [],
    };
  }
}

export async function getHomeData() {
  if (!isTypechoConfigured()) {
    return {
      groups: [],
      allPosts: [] as NormalizedPost[],
    };
  }

  const allPosts = await getAllPostsForListing();

  return {
    groups: groupPostsByYear(allPosts),
    allPosts,
  };
}

export async function getCategoryData(slug: string | null) {
  const categories = await getCategories();
  const excludedCategorySlugs = getExcludedCategorySlugs(categories);
  const normalizedSlug = slug?.trim() || null;
  const selectedSlug = normalizeCategorySlug(normalizedSlug);
  const hiddenCategorySelected = Boolean(selectedSlug && excludedCategorySlugs.has(selectedSlug));

  const posts = hiddenCategorySelected
    ? []
    : normalizePosts(
      (
        await getPosts({
          page: 1,
          pageSize: 100,
          filterType: normalizedSlug ? "category" : undefined,
          filterSlug: normalizedSlug ?? undefined,
          showDigest: "excerpt",
          limit: 96,
          showContent: true,
        })
      ).dataSet,
    ).filter((post) => !excludedCategorySlugs.has(normalizeCategorySlug(post.categorySlug)));

  const groups = groupPostsByYear(posts);
  const topCategories = categories
    .filter((item) => item.slug && item.name && !excludedCategorySlugs.has(normalizeCategorySlug(item.slug)))
    .map(mapCategoryToColumn)
    .sort((a, b) => b.count - a.count);

  return {
    categories: topCategories,
    groups,
  };
}

export async function getColumnsData() {
  const [allPosts, categories] = await Promise.all([getAllPostsForListing(), getCategories()]);
  return buildColumnsFromColumnCategory(categories, allPosts);
}

export async function getColumnDetailData(slug: string) {
  const [allPosts, categories] = await Promise.all([getAllPostsForListing(), getCategories()]);
  const columns = buildColumnsFromColumnCategory(categories, allPosts);

  const normalizedSlug = slug.trim();
  const matchedPosts = allPosts.filter(
    (post) => (post.seriesSlug || "").trim() === normalizedSlug,
  );

  const column = columns.find((item) => item.slug === normalizedSlug) ?? {
    slug: normalizedSlug,
    name: normalizedSlug,
    description: "",
    count: matchedPosts.length,
  };

  return {
    column,
    groups: groupPostsByYear(matchedPosts),
  };
}

function createAdjacentMap(posts: NormalizedPost[], currentCid: number) {
  const index = posts.findIndex((item) => item.cid === currentCid);
  if (index === -1) {
    return {
      prev: undefined as NormalizedPost | undefined,
      next: undefined as NormalizedPost | undefined,
    };
  }

  return {
    prev: posts[index + 1],
    next: posts[index - 1],
  };
}

function buildSideNavigationPosts(posts: NormalizedPost[], currentCid: number, limit = 9) {
  if (limit <= 0) {
    return [] as NormalizedPost[];
  }

  const sorted = [...posts].sort((a, b) => b.created - a.created);
  if (sorted.length <= limit) {
    return sorted;
  }

  const currentIndex = sorted.findIndex((item) => item.cid === currentCid);
  if (currentIndex === -1) {
    return sorted.slice(0, limit);
  }

  const halfWindow = Math.floor((limit - 1) / 2);
  let start = currentIndex - halfWindow;
  let end = start + limit;

  if (start < 0) {
    start = 0;
    end = limit;
  } else if (end > sorted.length) {
    end = sorted.length;
    start = Math.max(0, end - limit);
  }

  return sorted.slice(start, end);
}

function findColumnInfo(post: NormalizedPost, columns: ColumnInfo[]) {
  const slug = post.seriesSlug?.trim() || "";
  if (!slug) {
    return null;
  }

  return columns.find((item) => item.slug === slug) ?? null;
}

function buildColumnArticles(posts: NormalizedPost[], currentCid: number) {
  void currentCid;
  return posts.slice(0, 6);
}

function countArticleCharacters(html: string) {
  const plainText = stripHtml(html);
  return plainText.replace(/\s+/g, "").length;
}

function normalizeCounterLabel(raw: unknown, fallback = "--") {
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return String(Math.floor(parsed));
  }
  return fallback;
}

export async function getPostDetailData(
  slug: string,
  commentPage = 1,
  commentPageSize = DEFAULT_COMMENT_PAGE_SIZE,
) {
  const rawPost = await getPostBySlug(slug, 60);
  const post = normalizePost(rawPost);

  const [comments, archives, categories] = await Promise.all([
    post.commentValue === 0
      ? Promise.resolve<TypechoCommentsResponse>({
        page: commentPage,
        pageSize: commentPageSize,
        pages: 0,
        count: 0,
        dataSet: [],
      })
      : getComments({
        slug,
        page: commentPage,
        pageSize: commentPageSize,
        order: "desc",
        revalidate: COMMENT_CACHE_SECONDS,
      }),
    getArchives({ showDigest: "excerpt", limit: 92, showContent: true, order: "desc", revalidate: 60 }),
    getCategories(),
  ]);

  const article = await prepareArticleContent(post.html);
  const allPosts = flattenArchives(archives);
  const adjacent = createAdjacentMap(allPosts, post.cid);
  const sideNavigationPosts = buildSideNavigationPosts(allPosts, post.cid, 9);
  const columns = buildColumnsFromColumnCategory(categories, allPosts);

  const rawFields = rawPost.fields ?? {};
  const bannerImage =
    typeof rawFields.banner?.value === "string" && rawFields.banner.value.trim()
      ? rawFields.banner.value.trim()
      : undefined;
  const readCount =
    normalizeCounterLabel(
      rawPost.viewsNum,
      (typeof rawFields.readCount?.value === "string" && rawFields.readCount.value.trim()) || "--",
    );
  const likeCount =
    normalizeCounterLabel(
      rawPost.likesNum,
      (typeof rawFields.likeCount?.value === "string" && rawFields.likeCount.value.trim()) || "--",
    );
  const wordCount = countArticleCharacters(article.html);

  const seriesSlug = (post.seriesSlug || "").trim();
  const sameColumnPosts = seriesSlug
    ? allPosts.filter((item) => (item.seriesSlug || "").trim() === seriesSlug)
    : [];

  const column = findColumnInfo(post, columns);

  return {
    post: {
      ...post,
      html: article.html,
      coverImage: bannerImage,
    },
    readCount,
    likeCount,
    wordCount,
    comments: limitCommentDepth(normalizeCommentTree(comments.dataSet), 2),
    commentsPagination: {
      page: comments.page,
      pageSize: comments.pageSize,
      pages: comments.pages,
      count: comments.count,
    } satisfies CommentPagination,
    tocItems: article.tocItems,
    adjacent,
    sideNavigationPosts,
    column,
    columnArticles: buildColumnArticles(sameColumnPosts, post.cid),
  };
}

export async function getStaticPageDetailBySlug(
  slug: string,
  commentPage = 1,
  commentPageSize = DEFAULT_COMMENT_PAGE_SIZE,
) {
  if (!isTypechoConfigured()) {
    return null;
  }

  try {
    const rawPage = await getPostBySlug(slug, 60);
    const page = normalizePost(rawPage);
    const article = await prepareArticleContent(page.html);

    const commentResponse =
      page.commentValue === 0
        ? ({
          page: commentPage,
          pageSize: commentPageSize,
          pages: 0,
          count: 0,
          dataSet: [],
        } satisfies TypechoCommentsResponse)
        : await getComments({
          slug,
          page: commentPage,
          pageSize: commentPageSize,
          order: "desc",
          revalidate: COMMENT_CACHE_SECONDS,
        });

    return {
      page: {
        ...page,
        html: article.html,
      },
      comments: limitCommentDepth(normalizeCommentTree(commentResponse.dataSet), 2),
      commentsPagination: {
        page: commentResponse.page,
        pageSize: commentResponse.pageSize,
        pages: commentResponse.pages,
        count: commentResponse.count,
      } satisfies CommentPagination,
    };
  } catch {
    return null;
  }
}

export function buildTocFallback(postTitle: string): TocItem[] {
  return [
    {
      id: "content-1",
      text: postTitle,
      level: 2,
    },
  ];
}

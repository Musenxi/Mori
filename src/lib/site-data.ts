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
  prepareArticleContent,
} from "./typecho-normalize";
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
}

const DEFAULT_COMMENT_PAGE_SIZE = 10;

function mapCategoryToColumn(category: TypechoCategory): ColumnInfo {
  return {
    slug: String(category.slug),
    name: String(category.name),
    description: typeof category.description === "string" ? category.description : "",
    count: Number(category.count ?? 0),
  };
}

function stripAndSlice(text: string, fallback: string) {
  const compact = text.trim();
  if (compact.length > 0) {
    return compact;
  }
  return fallback;
}

function buildColumnsFromSeries(posts: NormalizedPost[]): ColumnInfo[] {
  const map = new Map<string, ColumnInfo>();

  posts.forEach((post) => {
    const slug = (post.seriesSlug || post.seriesName || "").trim();
    if (!slug) {
      return;
    }

    const name = (post.seriesName || slug).trim();
    const current = map.get(slug);

    if (current) {
      current.count += 1;
      return;
    }

    map.set(slug, {
      slug,
      name,
      description: "",
      count: 1,
    });
  });

  return [...map.values()].sort((a, b) => {
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
  const [categories, posts] = await Promise.all([
    getCategories(),
    getPosts({
      page: 1,
      pageSize: 100,
      filterType: slug ? "category" : undefined,
      filterSlug: slug ?? undefined,
      showDigest: "excerpt",
      limit: 96,
      showContent: true,
    }),
  ]);

  const groups = groupPostsByYear(normalizePosts(posts.dataSet));
  const topCategories = categories
    .filter((item) => item.slug && item.name)
    .map(mapCategoryToColumn)
    .sort((a, b) => b.count - a.count);

  return {
    categories: topCategories,
    groups,
  };
}

export async function getColumnsData() {
  const allPosts = await getAllPostsForListing();
  return buildColumnsFromSeries(allPosts);
}

export async function getColumnDetailData(slug: string) {
  const allPosts = await getAllPostsForListing();
  const columns = buildColumnsFromSeries(allPosts);

  const normalizedSlug = slug.trim();
  const matchedPosts = allPosts.filter(
    (post) => (post.seriesSlug || post.seriesName || "").trim() === normalizedSlug,
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

function findColumnInfo(post: NormalizedPost, columns: ColumnInfo[]) {
  const slug = post.seriesSlug?.trim() || "";
  const name = post.seriesName?.trim() || "";

  if (slug) {
    const bySlug = columns.find((item) => item.slug === slug);
    if (bySlug) {
      return bySlug;
    }
  }

  if (name) {
    const byName = columns.find((item) => item.name === name);
    if (byName) {
      return byName;
    }
  }

  return {
    slug: slug || name || "",
    name: name || "未设置专栏",
    description: name ? "" : "请在文章自定义字段 series 中填写专栏标识。",
    count: 0,
  };
}

function getCoverImage(post: NormalizedPost) {
  if (post.coverImage) {
    return post.coverImage;
  }
  return "/images/post-placeholder.svg";
}

function buildColumnArticles(posts: NormalizedPost[], currentCid: number) {
  return posts.filter((item) => item.cid !== currentCid).slice(0, 5);
}

export async function getPostDetailData(
  slug: string,
  commentPage = 1,
  commentPageSize = DEFAULT_COMMENT_PAGE_SIZE,
) {
  const rawPost = await getPostBySlug(slug, false);
  const post = normalizePost(rawPost);

  const [comments, archives] = await Promise.all([
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
        revalidate: false,
      }),
    getArchives({ showDigest: "excerpt", limit: 92, showContent: true, order: "desc", revalidate: false }),
  ]);

  const article = prepareArticleContent(post.html);
  const allPosts = flattenArchives(archives);
  const adjacent = createAdjacentMap(allPosts, post.cid);
  const columns = buildColumnsFromSeries(allPosts);

  const rawFields = rawPost.fields ?? {};
  const readCount =
    (typeof rawFields.readCount?.value === "string" && rawFields.readCount.value.trim()) || "--";
  const likeCount =
    (typeof rawFields.likeCount?.value === "string" && rawFields.likeCount.value.trim()) || "--";

  const seriesSlug = (post.seriesSlug || post.seriesName || "").trim();
  const sameColumnPosts = seriesSlug
    ? allPosts.filter((item) => (item.seriesSlug || item.seriesName || "").trim() === seriesSlug)
    : [];

  const column = findColumnInfo(post, columns);

  return {
    post: {
      ...post,
      html: article.html,
      coverImage: getCoverImage(post),
    },
    readCount,
    likeCount,
    comments: limitCommentDepth(normalizeCommentTree(comments.dataSet), 2),
    commentsPagination: {
      page: comments.page,
      pageSize: comments.pageSize,
      pages: comments.pages,
      count: comments.count,
    } satisfies CommentPagination,
    tocItems: article.tocItems,
    adjacent,
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
          revalidate: false,
        });

    return {
      page,
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

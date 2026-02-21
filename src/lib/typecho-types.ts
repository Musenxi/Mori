export interface TypechoEnvelope<T> {
  status: "success" | "error";
  message: string;
  data: T;
}

export interface TypechoField {
  name: string;
  type: string;
  value: string;
}

export interface TypechoMeta {
  mid: number;
  name: string;
  slug: string;
  description?: string;
  count?: number;
  [key: string]: unknown;
}

export interface TypechoCategory extends TypechoMeta {
  parent?: number;
  permalink?: string;
  levels?: number;
  children?: TypechoCategory[];
}

export interface TypechoPostRaw {
  cid: number;
  title: string;
  slug: string;
  created: number;
  modified?: number;
  commentsNum?: number;
  type?: "post" | "page" | string;
  text?: string;
  digest?: string;
  permalink?: string;
  fields?: Record<string, TypechoField>;
  categories?: Array<{ name?: string; slug?: string }>;
  tags?: Array<{ name?: string; slug?: string }>;
  [key: string]: unknown;
}

export interface TypechoPostsResponse {
  page: number;
  pageSize: number;
  pages: number;
  count: number;
  dataSet: TypechoPostRaw[];
}

export type TypechoArchivesResponse = {
  count: number;
  dataSet: Record<string, Record<string, TypechoPostRaw[]>>;
};

export interface TypechoCommentRaw {
  coid: number;
  parent: number;
  cid: number;
  created: number;
  author: string;
  url?: string;
  text: string;
  status: string;
  mailHash?: string;
  children?: TypechoCommentRaw[];
}

export interface TypechoCommentsResponse {
  page: number;
  pageSize: number;
  pages: number;
  count: number;
  dataSet: TypechoCommentRaw[];
}

export interface CommentPagination {
  page: number;
  pageSize: number;
  pages: number;
  count: number;
}

export interface TypechoSettings {
  title: string;
  description: string;
  keywords: string;
  timezone: string;
  [key: string]: unknown;
}

export interface TypechoPageItem {
  cid: number;
  title: string;
  created: number;
  slug: string;
}

export interface TypechoPagesResponse {
  count: number;
  dataSet: TypechoPageItem[];
}

export interface TypechoRecentCommentsResponse {
  count: number;
  dataSet: Array<{
    coid: number;
    cid: number;
    author: string;
    text: string;
  }>;
}

export interface NormalizedPost {
  cid: number;
  slug: string;
  title: string;
  permalink?: string;
  created: number;
  createdLabel: string;
  shortDate: string;
  commentsNum: number;
  commentValue: 0 | 1 | 2;
  excerpt: string;
  html?: string;
  categoryName: string;
  categorySlug?: string;
  seriesName?: string;
  seriesSlug?: string;
  tags: Array<{ name: string; slug?: string }>;
  coverImage?: string;
}

export interface YearGroupedPosts {
  year: string;
  posts: NormalizedPost[];
}

export interface NormalizedComment {
  coid: number;
  parent: number;
  author: string;
  replyTo?: string;
  initial: string;
  url?: string;
  created: number;
  createdLabel: string;
  html: string;
  mailHash?: string;
  avatarUrl?: string;
  children: NormalizedComment[];
}

export interface TocItem {
  id: string;
  text: string;
  level: number;
}

# Mori Frontend (Next.js + Tailwind)

基于 `Typecho + typecho-plugin-Restful` 的可落地前端实现，页面风格按 `frontend.pen` 设计稿还原。

## 已实现页面

- `/` 首页（按年份分组 + 大号年份水印）
- `/category` 分类页（分类筛选 + 文章列表）
- `/column` 专栏页（专栏卡片列表）
- `/column/[slug]` 单专栏页（专栏信息 + 年份文章列表）
- `/post/[slug]` 文章详情页（标题区、正文、桌面侧栏目录、移动目录抽屉、上下篇、评论列表/提交）
- `/about` `/friends` `/comment`（固定 slug 页面）
- `/page/[slug]`（其它自定义页面）

## 技术栈

- Next.js App Router
- React 19
- Tailwind CSS v4
- `next-themes`（日/夜主题切换）
- `sanitize-html`（文章与评论 HTML 安全过滤）

## 本地运行

```bash
pnpm install
pnpm dev
```

默认地址：`http://localhost:3000`

## 环境变量

在项目根目录新建 `.env.local`：

```bash
TYPECHO_API_BASE_URL="https://your-typecho-site.com/api"
TYPECHO_API_TOKEN="your-plugin-api-token"
TYPECHO_REVALIDATE_SECONDS="90"
```

如果 Typecho 没开伪静态，请使用：

```bash
TYPECHO_API_BASE_URL="https://your-typecho-site.com/index.php/api"
```

## Typecho Restful 插件要求

请确保插件后台开启至少这些接口：

- `posts`
- `post`
- `comments`
- `comment`
- `pages`
- `categories`
- `archives`
- `settings`

并确保：

- `apiToken` 与前端环境变量一致（如你启用了 token 校验）
- 评论提交依赖 `csrfSalt`，请不要留空
- 你的站点可被前端服务端访问（SSR 请求）

## 自定义字段约定

- 专栏：`series`
- 文章头图：`banner`
- 阅读/点赞：预留，后续可接插件字段

## Header 导航规则

- 固定 slug 存在才显示：
- `category` -> 分类 (`/category`)
- `comment` -> 留言 (`/comment`)
- `friends` -> 友人 (`/friends`)
- `about` -> 关于 (`/about`)
- 其它新建页面自动显示在 Header，路由为 `/page/[slug]`

## 设计稿

- `frontend.pen`

## 校验命令

```bash
pnpm lint
pnpm build
```

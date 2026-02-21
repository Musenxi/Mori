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
GRAVATAR_PREFIX="https://gravatar.com/avatar/"
```

如果 Typecho 没开伪静态，请使用：

```bash
TYPECHO_API_BASE_URL="https://your-typecho-site.com/index.php/api"
```

`GRAVATAR_PREFIX` 用于评论头像解析，支持以下形式：

- `https://gravatar.com/avatar/`（自动追加 hash）
- `https://cravatar.cn/avatar/`（自动追加 hash）
- `https://gravatar.com/avatar/{hash}?d=mp&s=80`（显式占位）
- `https://gravatar.com/avatar/%s?d=mp&s=80`（`%s` 占位）

说明：

- 未显式传 `d=` 参数时，系统会自动追加 `d=404`，用于在没有头像时回退为首字母。
- 如果希望展示 Gravatar 默认头像，请显式传 `d=identicon`/`d=mp` 等参数。

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

以下字段均为 **Typecho 文章/页面自定义字段**，字段名区分大小写，按下列 key 使用：

| 字段 key | 是否必填 | 用途 | 取值规则 |
| --- | --- | --- | --- |
| `brief` | 否 | 文章列表描述 | 仅用于文章列表描述展示；有值时显示该内容，无值时不显示描述。正文截断不再作为回退来源。 |
| `series` | 否 | 专栏标识 | 值必须精确匹配 `column` 父分类下某个子分类的 `slug`；匹配时显示“所属专栏”卡片与左侧专栏列表，不匹配或为空时不显示。 |
| `banner` | 否 | 文章头图 | 有值时作为文章头图；无值时回退为正文首图，再回退默认占位图。 |
| `commentvalue` | 否 | 评论开关 | `0`：隐藏评论区；`2`：显示历史评论但禁止发表评论；其它值或为空：正常显示并允许评论。 |
| `readCount` | 否 | 阅读数展示位 | 当前仅前端展示占位；有值显示字段值，无值显示 `--`。 |
| `likeCount` | 否 | 点赞数展示位 | 当前仅前端展示占位；有值显示字段值，无值显示 `--`。 |

## 专栏分类约定

- 必须存在父分类：`slug = column`
- 专栏项使用 `column` 的子分类表示，每个子分类对应一个 `series`
- 前端不再从文章列表自动推导专栏，专栏数据以该分类树为唯一来源
- 子分类描述格式：`[icon][describe]`
- `icon` 支持：
- 文本图标（例如 `✦`）
- 图片链接（`https://...`、`/path/...`、`data:image/...`）
- base64 svg（`base64:...`、`base64,...` 或纯 base64 字符串）
- 原始 SVG 字符串（`<svg ...>...</svg>`）

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

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
- Socket.IO（计数与在线状态实时同步）

## 本地运行

```bash
pnpm install
pnpm dev
```

默认地址：`http://localhost:3000`

说明：`pnpm dev` / `pnpm start` 现在通过项目根目录的 `server.mjs` 启动 Next.js + Socket.IO 同进程服务。

## 环境变量

在项目根目录新建 `.env.local`：

```bash
TYPECHO_API_BASE_URL="https://your-typecho-site.com/api"
TYPECHO_API_TOKEN="your-plugin-api-token"
TYPECHO_REVALIDATE_SECONDS="90"
GRAVATAR_PREFIX="https://gravatar.com/avatar/"
REDIS_URL="redis://127.0.0.1:6379"
REDIS_KEY_PREFIX="mori"
SOCKET_INTERNAL_TOKEN="replace-with-a-strong-random-string"
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

Redis 说明：

- `REDIS_URL` 与 `REDIS_HOST` 二选一；`REDIS_URL` 优先级更高。
- 使用 `REDIS_HOST` 时可选配 `REDIS_PORT`（默认 `6379`）、`REDIS_USERNAME`、`REDIS_PASSWORD`、`REDIS_DB`。
- `REDIS_KEY_PREFIX` 用于区分缓存命名空间，默认值为 `mori`。
- 推荐优先使用 `REDIS_URL`，配置更简单。

`REDIS_URL` 示例（推荐）：

```bash
# 本地无密码
REDIS_URL="redis://127.0.0.1:6379"

# 有密码（无用户名）
REDIS_URL="redis://:your_password@127.0.0.1:6379/0"

# ACL 用户名 + 密码
REDIS_URL="redis://default:your_password@127.0.0.1:6379/0"

# 云 Redis / TLS
REDIS_URL="rediss://default:your_password@your-host:6379/0"

REDIS_KEY_PREFIX="mori"
```

`REDIS_HOST` 拆分模式示例：

```bash
REDIS_URL=""
REDIS_HOST="127.0.0.1"
REDIS_PORT="6379"
REDIS_USERNAME="default"      # 无用户名可留空
REDIS_PASSWORD="your_password" # 无密码可留空
REDIS_DB="0"
REDIS_KEY_PREFIX="mori"
```

注意：

- 如果同时配置了 `REDIS_URL` 和 `REDIS_HOST`，系统会优先使用 `REDIS_URL`。
- 如果密码含有 `@`、`:`、`/`、`?`、`#` 等字符，写在 `REDIS_URL` 时请做 URL 编码（例如 `@` -> `%40`）。
- 修改 `.env.local` 后请重启应用进程使配置生效。

文章浏览/点赞统计：

- 前端会调用 `/api/post-stats`（Next API）代理到 Typecho Restful 的 `stats/view/like` 接口。
- 浏览数与点赞数最终同步写入 Typecho `contents` 表中的 `viewsNum`、`likesNum`。
- 去重基于 Cookie：在 Cookie 未过期前，同一浏览器不重复计数。

Socket.IO 实时同步：

- 服务端在 `POST /api/post-stats` 成功计数后，会广播 `post:counter-updated` 事件（浏览/点赞实时更新）。
- 服务端会广播 `presence:online`（全站在线连接数）和 `presence:post-reading`（单篇文章实时阅读人数）。
- `SOCKET_INTERNAL_TOKEN` 用于保护内部广播桥接接口（`/internal/socket-broadcast`），生产环境建议使用高强度随机值。
- 计数房间：
- `post:<cid>`
- `post:slug:<slug>`
- 阅读状态房间：
- `presence:post:<cid>`
- `presence:post:slug:<slug>`
- 前端显示位置：
- Footer：`正在被X人看爆`（全站在线人数）
- 文章页元信息区（点赞后）：`X人正在阅读`（当前文章在线阅读人数）

Redis 缓存范围（Mori）：

- 仅缓存 Typecho API 的 GET 请求，且 `revalidate !== false` 的请求会落 Redis。
- Redis key 结构：
- `<REDIS_KEY_PREFIX>:typecho:<TYPECHO_API_BASE_URL>:GET:<path>?<sortedQuery>`
- 典型会被缓存的数据：`settings`、`pages`、`categories`、`tags`、`posts`、`archives`、`post`、`comments`。
- 以下不会走 Redis 缓存：
- 所有 POST 请求（如评论提交、浏览+1、点赞+1）
- `revalidate: false` 的请求（显式 no-store）
- Redis 不可用时，应用会自动降级到直连 Typecho，并输出一次告警日志：`[redis] disabled due to connection error: ...`

怎么判断 Redis 是否连上：

- 用 `redis-cli` 直接探活：

```bash
redis-cli -h 127.0.0.1 -p 6379 ping
# 预期输出：PONG
```

- 启动 Mori 后请求几个页面，再看是否有缓存键（以 `REDIS_KEY_PREFIX=mori` 为例）：

```bash
redis-cli --scan --pattern 'mori:typecho:*' | head
```

- 若服务日志出现 `[redis] disabled due to connection error`，表示 Redis 未成功接入，当前处于降级模式。

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
| `readCount` | 否 | 阅读数字段回退 | 已优先使用 Restful 返回的 `viewsNum`；仅在未返回时回退此字段。 |
| `likeCount` | 否 | 点赞数字段回退 | 已优先使用 Restful 返回的 `likesNum`；仅在未返回时回退此字段。 |

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

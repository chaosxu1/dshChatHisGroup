/**
 * dsh-session-history 的 Host 半边。
 *
 * 这个插件是纯浏览器侧的 UI：历史会话列表全部来自客户端已有的会话目录
 * （`useSessions`）与工作区快照（`useWorkspaces`），不需要 Host 新增任何服务、
 * 工具或事件。这里保留一个空的 apply，只为让 Loader 有一行可加载的包入口，
 * 浏览器半边由 package.json 的 `dsh.client` 声明加载。
 */
export function apply() {}

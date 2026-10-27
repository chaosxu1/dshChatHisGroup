/**
 * dsh-session-history 的浏览器半边。
 *
 * 在会话头部的页签行（对话 / 轨迹 / 上下文 / 编队）之后加一个「历史会话」页签，
 * 页签内容是一张按分组浏览全部历史会话的列表：
 *
 *   - 分组方式：按工作区（默认）/ 按时间 / 按分组
 *   - 按分组：可新建、重命名、删除，并把任意会话移入某个分组；
 *     分组数据与折叠状态、搜索词之外的视图偏好存在浏览器本地（localStorage）
 *   - 点击任意一行：打开那条历史会话（回到「对话」页签）
 *
 * 数据全部来自框架已经投影好的两份快照（`useSessions` 的会话目录与
 * `useWorkspaces` 的工作区/置顶/归档集合），本插件自己不订阅会话事件、
 * 不写 DOM、也不追加任何会话事件。
 */
window.__ModuleLoader__.load({
	id: 'dsh-session-history',
	factory: (require) => {
		const React = require('react')
		const h = React.createElement

		/** 页签 id：`conversation.view` 的 cell key。 */
		const VIEW_ID = 'history'
		/** 打开会话后要切回的页签 id（内置对话视图）。 */
		const CHAT_VIEW_ID = 'chat'
		/** 文案命名空间。 */
		const NS = 'dsh.session-history'
		/** 浏览器本地视图偏好（分组方式、折叠状态、分组定义）。 */
		const STORAGE_KEY = 'dsh.session-history.view.v1'
		/** "刚点了哪条会话"的有效期：超过这个时间就不再把新会话切回对话页签。 */
		const PENDING_TTL_MS = 4000

		/**
		 * 跨挂载记住刚点击的会话 id。
		 *
		 * 为什么需要：本页签是「每个会话各记一份当前视图」的，如果目标会话上次
		 * 停在「历史会话」页签，导航过去之后仍旧渲染这份列表，看起来像"点了没
		 * 反应"。所以在目标会话挂载本视图时，主动切回「对话」。若目标会话本来
		 * 就停在「对话」，本视图不会挂载，这个标记随后过期失效。
		 */
		let pendingOpen = null

		/* ------------------------------------------------------------------ *
		 * 文案
		 * ------------------------------------------------------------------ */

		const zh = {
			'view.label': '历史会话',
			'search.placeholder': '搜索标题或工作区',
			'mode.workspace': '按工作区',
			'mode.time': '按时间',
			'mode.custom': '按分组',
			'time.today': '今天',
			'time.yesterday': '昨天',
			'time.week': '近 7 天',
			'time.month': '近 30 天',
			'time.older': '更早',
			'group.ungrouped': '未分组',
			'action.showArchived': '显示已归档',
			'action.newGroup': '＋ 新建分组',
			'action.rename': '重命名',
			'action.delete': '删除',
			'action.move': '移动到分组',
			'action.createAndMove': '新建分组并移入',
			'action.filterByGroup': '只看这个分组',
			'filter.label': '按分组筛选',
			'filter.all': '全部分组',
			'notice.moved': '已移入「{name}」',
			'notice.ungrouped': '已移回未分组',
			'group.newPlaceholder': '分组名称，回车创建',
			'group.renamePlaceholder': '分组名称',
			'confirm.delete': '删除分组「{name}」？组内会话会回到未分组。',
			'archive.badge': '已归档',
			'empty.search': '没有匹配的会话',
			'empty.searchHint': '换个关键词，或切换分组方式。',
			'empty.group': '这个分组下没有可见会话',
			'empty.groupHint': '换一个分组，或选「全部分组」。',
			'empty.none': '还没有历史会话',
			'empty.noneHint': '开始一段对话后，会话会出现在这里。',
			'untitled': '未命名会话',
			'pinned': '已置顶',
			'rel.justNow': '刚刚',
			'rel.minutes': '{n} 分钟前',
			'rel.hours': '{n} 小时前',
			'rel.days': '{n} 天前',
			'count.summary': '{sessions} 个会话 · {workspaces} 个工作区'
		}

		const en = {
			'view.label': 'History',
			'search.placeholder': 'Search title or workspace',
			'mode.workspace': 'By workspace',
			'mode.time': 'By time',
			'mode.custom': 'By group',
			'time.today': 'Today',
			'time.yesterday': 'Yesterday',
			'time.week': 'Last 7 days',
			'time.month': 'Last 30 days',
			'time.older': 'Earlier',
			'group.ungrouped': 'Ungrouped',
			'action.showArchived': 'Show archived',
			'action.newGroup': '+ New group',
			'action.rename': 'Rename',
			'action.delete': 'Delete',
			'action.move': 'Move to group',
			'action.createAndMove': 'New group with it',
			'action.filterByGroup': 'Show only this group',
			'filter.label': 'Filter by group',
			'filter.all': 'All groups',
			'notice.moved': 'Moved to “{name}”',
			'notice.ungrouped': 'Moved back to Ungrouped',
			'group.newPlaceholder': 'Group name, Enter to create',
			'group.renamePlaceholder': 'Group name',
			'confirm.delete': 'Delete the group “{name}”? Its sessions return to Ungrouped.',
			'archive.badge': 'Archived',
			'empty.search': 'No matching session',
			'empty.searchHint': 'Try another keyword, or switch the grouping.',
			'empty.group': 'No visible session in this group',
			'empty.groupHint': 'Pick another group, or choose “All groups”.',
			'empty.none': 'No history yet',
			'empty.noneHint': 'Sessions appear here once you start a conversation.',
			'untitled': 'Untitled session',
			'pinned': 'Pinned',
			'rel.justNow': 'just now',
			'rel.minutes': '{n} min ago',
			'rel.hours': '{n} h ago',
			'rel.days': '{n} d ago',
			'count.summary': '{sessions} sessions · {workspaces} workspaces'
		}

		/* ------------------------------------------------------------------ *
		 * 纯函数工具
		 * ------------------------------------------------------------------ */

		/**
		 * 取路径最后一段作为工作区显示名。
		 * @param {string} path 目录路径（Windows 或 POSIX）
		 * @returns {string} 最后一段，取不到时返回空串
		 */
		function basename(path) {
			if (typeof path !== 'string') return ''
			const trimmed = path.replace(/[\\/]+$/, '')
			if (trimmed === '') return ''
			const parts = trimmed.split(/[\\/]/)
			return parts.length === 0 ? '' : parts[parts.length - 1]
		}

		/**
		 * 会话行标题：优先持久化标题，其次目录名（`displayTitle`），最后留空由调用方兜底。
		 * @param {object} summary 会话摘要
		 * @returns {string} 标题，可能为空串
		 */
		function titleOf(summary) {
			if (summary === null || summary === undefined) return ''
			const stored = typeof summary.title === 'string' ? summary.title.trim() : ''
			if (stored !== '') return stored
			const fallback = typeof summary.displayTitle === 'string' ? summary.displayTitle.trim() : ''
			if (fallback !== '' && fallback !== summary.id) return fallback
			return ''
		}

		/**
		 * 相对时间文案（与侧栏一致的口径：刚刚 / 分钟 / 小时 / 天 / 日期）。
		 * @param {number} value epoch 毫秒
		 * @param {(key: string, params?: object) => string} t 翻译函数
		 * @returns {string} 展示文本
		 */
		function relativeTime(value, t) {
			if (typeof value !== 'number' || value <= 0) return ''
			const diff = Date.now() - value
			if (diff < 60 * 1000) return t('rel.justNow')
			if (diff < 60 * 60 * 1000) return t('rel.minutes', { n: Math.floor(diff / 60000) })
			if (diff < 24 * 60 * 60 * 1000) return t('rel.hours', { n: Math.floor(diff / 3600000) })
			if (diff < 7 * 24 * 60 * 60 * 1000) return t('rel.days', { n: Math.floor(diff / 86400000) })
			return new Date(value).toLocaleDateString()
		}

		/**
		 * 「按时间」分组的时间桶。
		 * @param {number} value epoch 毫秒
		 * @returns {'today'|'yesterday'|'week'|'month'|'older'} 桶 id
		 */
		function timeBucket(value) {
			const start = new Date()
			start.setHours(0, 0, 0, 0)
			const today = start.getTime()
			if (value >= today) return 'today'
			if (value >= today - 86400000) return 'yesterday'
			if (value >= today - 6 * 86400000) return 'week'
			if (value >= today - 29 * 86400000) return 'month'
			return 'older'
		}

		/* ------------------------------------------------------------------ *
		 * 浏览器本地视图偏好
		 * ------------------------------------------------------------------ */

		const DEFAULT_VIEW = { mode: 'workspace', collapsed: {}, groups: [], assignments: {} }

		/** 槽位没有提供标准 hooks 时的空会话目录，保证页面仍能渲染空状态。 */
		const EMPTY_LIST = { ids: [], byId: {} }
		/** 同上：空工作区快照。 */
		const EMPTY_WORKSPACES = { items: [], archivedSessionIds: [], pinnedSessionIds: [] }

		/**
		 * 读取并清洗本地视图偏好；任何异常都退回默认值，绝不让面板因此白屏。
		 * @returns {{mode: string, collapsed: object, groups: Array, assignments: object}} 视图偏好
		 */
		function readView() {
			const fallback = { ...DEFAULT_VIEW }
			try {
				const raw = window.localStorage.getItem(STORAGE_KEY)
				if (raw === null || raw === '') return fallback
				const parsed = JSON.parse(raw)
				if (parsed === null || typeof parsed !== 'object') return fallback
				const mode =
					parsed.mode === 'time' || parsed.mode === 'custom' || parsed.mode === 'workspace'
						? parsed.mode
						: 'workspace'
				const collapsed =
					parsed.collapsed !== null && typeof parsed.collapsed === 'object' ? parsed.collapsed : {}
				const groups = Array.isArray(parsed.groups)
					? parsed.groups.filter(
							(group) =>
								group !== null &&
								typeof group === 'object' &&
								typeof group.id === 'string' &&
								typeof group.name === 'string'
						)
					: []
				const assignments =
					parsed.assignments !== null && typeof parsed.assignments === 'object'
						? parsed.assignments
						: {}
				return { mode, collapsed, groups, assignments }
			} catch {
				return fallback
			}
		}

		/**
		 * 保存视图偏好；写入失败（隐私模式、配额满）只影响记忆，不影响使用。
		 * @param {object} view 视图偏好
		 */
		function writeView(view) {
			try {
				window.localStorage.setItem(STORAGE_KEY, JSON.stringify(view))
			} catch {}
		}

		/**
		 * 生成一个足够唯一的本地分组 id。
		 * @returns {string} 分组 id
		 */
		function newGroupId() {
			return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
		}

		/* ------------------------------------------------------------------ *
		 * 数据推导
		 * ------------------------------------------------------------------ */

		/**
		 * 把两份快照折成一行行可渲染的会话数据，顺序沿用 Host 的活动时间顺序。
		 *
		 * 过滤口径与侧栏一致：隐藏子代理来源的会话和还没开始过的空白会话；
		 * 归档集合单独标记，由「显示已归档」开关决定是否展示。
		 *
		 * @param {object} list `useSessions` 快照（ids / byId）
		 * @param {object} snapshot `useWorkspaces` 快照（items / 置顶 / 归档）
		 * @returns {Array<object>} 行数据
		 */
		function buildRows(list, snapshot) {
			const rows = []
			if (list === null || list === undefined || !Array.isArray(list.ids)) return rows
			const byId = list.byId !== null && typeof list.byId === 'object' ? list.byId : {}
			const items = snapshot !== null && snapshot !== undefined && Array.isArray(snapshot.items) ? snapshot.items : []
			const archived = new Set(
				snapshot !== null && snapshot !== undefined && Array.isArray(snapshot.archivedSessionIds)
					? snapshot.archivedSessionIds
					: []
			)
			const pinned = new Set(
				snapshot !== null && snapshot !== undefined && Array.isArray(snapshot.pinnedSessionIds)
					? snapshot.pinnedSessionIds
					: []
			)

			// 会话 id -> 所属工作区，供"按工作区"分组和行内工作区标签共用。
			const owner = new Map()
			for (const workspace of items) {
				if (workspace === null || workspace === undefined) continue
				const ids = Array.isArray(workspace.sessionIds) ? workspace.sessionIds : []
				for (const id of ids) owner.set(String(id), workspace)
			}

			for (const rawId of list.ids) {
				const id = String(rawId)
				const summary = byId[rawId] !== undefined ? byId[rawId] : byId[id]
				if (summary === null || summary === undefined) continue
				if (summary.origin === 'subagent') continue
				if (summary.blank === true) continue
				const workspace = owner.get(id)
				rows.push({
					id,
					title: titleOf(summary),
					updatedAt: typeof summary.updatedAt === 'number' ? summary.updatedAt : 0,
					running: summary.running === true,
					archived: archived.has(rawId) || archived.has(id),
					pinned: pinned.has(rawId) || pinned.has(id),
					workspaceId: workspace === undefined ? '' : String(workspace.workspaceId),
					workspaceTitle:
						workspace === undefined
							? ''
							: typeof workspace.title === 'string' && workspace.title.trim() !== ''
								? workspace.title
								: basename(workspace.path)
				})
			}
			return rows
		}

		/**
		 * 按当前分组方式把行数据分成若干组。
		 *
		 * 组内保持传入顺序（Host 活动时间序）；空组直接丢弃，避免出现一串
		 * 只有一个标题的分组。
		 *
		 * @param {Array<object>} rows 已过滤的行数据
		 * @param {object} snapshot `useWorkspaces` 快照
		 * @param {object} view 视图偏好
		 * @param {(key: string, params?: object) => string} t 翻译函数
		 * @returns {Array<{key: string, label: string, custom: boolean, groupId: string, rows: Array<object>}>} 分组
		 */
		function buildGroups(rows, snapshot, view, t) {
			const groups = []
			if (view.mode === 'workspace') {
				const items =
					snapshot !== null && snapshot !== undefined && Array.isArray(snapshot.items) ? snapshot.items : []
				const buckets = new Map()
				for (const row of rows) {
					const key = 'w:' + row.workspaceId
					if (!buckets.has(key)) buckets.set(key, [])
					buckets.get(key).push(row)
				}
				for (const workspace of items) {
					if (workspace === null || workspace === undefined) continue
					const key = 'w:' + String(workspace.workspaceId)
					const members = buckets.get(key)
					if (members === undefined || members.length === 0) continue
					buckets.delete(key)
					const label =
						typeof workspace.title === 'string' && workspace.title.trim() !== ''
							? workspace.title
							: basename(workspace.path)
					groups.push({ key, label: label === '' ? t('group.ungrouped') : label, custom: false, groupId: '', rows: members })
				}
				for (const [key, members] of buckets) {
					groups.push({ key, label: t('group.ungrouped'), custom: false, groupId: '', rows: members })
				}
				return groups
			}

			if (view.mode === 'time') {
				const order = ['today', 'yesterday', 'week', 'month', 'older']
				const buckets = new Map()
				for (const row of rows) {
					const bucket = timeBucket(row.updatedAt)
					if (!buckets.has(bucket)) buckets.set(bucket, [])
					buckets.get(bucket).push(row)
				}
				for (const bucket of order) {
					const members = buckets.get(bucket)
					if (members === undefined || members.length === 0) continue
					groups.push({ key: 't:' + bucket, label: t('time.' + bucket), custom: false, groupId: '', rows: members })
				}
				return groups
			}

			// 按分组：先按用户定义的顺序出组，剩下的进未分组。
			const known = new Set()
			for (const group of view.groups) known.add(group.id)
			const buckets = new Map()
			for (const row of rows) {
				const assigned = view.assignments[row.id]
				const key = typeof assigned === 'string' && known.has(assigned) ? assigned : ''
				if (!buckets.has(key)) buckets.set(key, [])
				buckets.get(key).push(row)
			}
			for (const group of view.groups) {
				const members = buckets.get(group.id)
				if (members === undefined || members.length === 0) continue
				groups.push({ key: 'c:' + group.id, label: group.name, custom: true, groupId: group.id, rows: members })
			}
			const loose = buckets.get('')
			if (loose !== undefined && loose.length > 0) {
				groups.push({ key: 'c:', label: t('group.ungrouped'), custom: false, groupId: '', rows: loose })
			}
			return groups
		}

		/* ------------------------------------------------------------------ *
		 * 图形
		 * ------------------------------------------------------------------ */

		/** 分组折叠箭头。 */
		function Chevron({ open }) {
			return h(
				'svg',
				{
					width: 10,
					height: 10,
					viewBox: '0 0 10 10',
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: 1.6,
					strokeLinecap: 'round',
					strokeLinejoin: 'round',
					'aria-hidden': true,
					style: {
						flex: 'none',
						transform: open ? 'rotate(90deg)' : 'none',
						transition: 'transform .12s ease'
					}
				},
				h('path', { d: 'M3.5 1.5 7 5 3.5 8.5' })
			)
		}

		/** 标题栏里的放大镜。 */
		function SearchGlyph() {
			return h(
				'span',
				{ className: 'dsh-sh-search-icon', 'aria-hidden': true },
				h(
					'svg',
					{
						width: 13,
						height: 13,
						viewBox: '0 0 16 16',
						fill: 'none',
						stroke: 'currentColor',
						strokeWidth: 1.4,
						strokeLinecap: 'round'
					},
					h('circle', { cx: 7, cy: 7, r: 4.4 }),
					h('path', { d: 'M10.3 10.3 14 14' })
				)
			)
		}

		/** 置顶标记。 */
		function PinGlyph() {
			return h(
				'svg',
				{
					width: 11,
					height: 11,
					viewBox: '0 0 16 16',
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: 1.5,
					strokeLinecap: 'round',
					strokeLinejoin: 'round',
					'aria-hidden': true
				},
				h('path', { d: 'M9.6 2.4 13.6 6.4l-1.7.5-3 3 .3 2.4-1.4 1.4-2.5-2.5-3.5 3.5 3.5-3.5-2.5-2.5L2.2 9l2.4.3 3-3z' })
			)
		}

		/** 行尾"移动到分组"标记。 */
		function MoveGlyph() {
			return h(
				'svg',
				{
					width: 13,
					height: 13,
					viewBox: '0 0 16 16',
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: 1.4,
					strokeLinecap: 'round',
					strokeLinejoin: 'round',
					'aria-hidden': true
				},
				h('path', { d: 'M2 4.5h4l1.2 1.4h6.3v6.1a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z' }),
				h('path', { d: 'M2 4.5V3.2a1 1 0 0 1 1-1h2.6l1 1.3h3.9a1 1 0 0 1 1 1v1.4' })
			)
		}

		/** 空列表图形。 */
		function EmptyGlyph() {
			return h(
				'svg',
				{
					width: 28,
					height: 28,
					viewBox: '0 0 64 64',
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: 3,
					strokeLinecap: 'round',
					strokeLinejoin: 'round',
					'aria-hidden': true,
					style: { opacity: 0.45 }
				},
				h('path', { d: 'M32 20A13 13 0 1 1 20.7 26.5' }),
				h('path', { d: 'M20.7 18.5V26.5H28.7' }),
				h('path', { d: 'M32 25.5V33L37.5 36.2' })
			)
		}

		/* ------------------------------------------------------------------ *
		 * 样式（只使用主题 token，随亮/暗主题自动切换）
		 * ------------------------------------------------------------------ */

		const CSS = [
			'.dsh-sh-root{display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary,inherit)}',
			'.dsh-sh-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 20px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}',
			'.dsh-sh-search-wrap{position:relative;display:flex;align-items:center;flex:1 1 220px;max-width:320px}',
			'.dsh-sh-search-icon{position:absolute;left:9px;display:flex;color:var(--dsw-alias-label-secondary);pointer-events:none}',
			'.dsh-sh-search{width:100%;height:30px;padding:0 10px 0 29px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;font-size:13px}',
			'.dsh-sh-search:focus{outline:none;border-color:var(--dsw-alias-border-l2)}',
			'.dsh-sh-search::placeholder{color:var(--dsw-alias-label-secondary)}',
			'.dsh-sh-seg{display:inline-flex;align-items:center;gap:2px;flex:none}',
			'.dsh-sh-seg button{position:relative;border:none;background:transparent;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font:inherit;font-size:13px;line-height:20px;padding:4px 10px 8px;border-radius:6px;cursor:pointer;white-space:nowrap}',
			'.dsh-sh-seg button:hover{color:var(--dsw-alias-label-primary)}',
			'.dsh-sh-seg button:focus-visible{outline:1px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-1px}',
			'.dsh-sh-seg button[aria-pressed="true"]{color:var(--dsw-alias-state-business-primary,var(--dsw-alias-link))}',
			'.dsh-sh-seg button[aria-pressed="true"]::after{content:"";position:absolute;left:9px;right:9px;bottom:0;height:2px;border-radius:1px 1px 0 0;background:var(--dsw-alias-state-business-primary,var(--dsw-alias-link))}',
			'.dsh-sh-check{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none;user-select:none}',
			'.dsh-sh-check input{width:13px;height:13px;margin:0;accent-color:var(--dsw-alias-brand-primary)}',
			'.dsh-sh-btn{height:26px;padding:0 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer;flex:none}',
			'.dsh-sh-btn:hover{border-color:var(--dsw-alias-border-l2)}',
			'.dsh-sh-count{margin-left:auto;font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap;flex:none;font-variant-numeric:tabular-nums}',
			'.dsh-sh-notice{font-size:12px;color:var(--dsw-alias-link,inherit);white-space:nowrap;flex:none;overflow:hidden;text-overflow:ellipsis;max-width:240px}',
			'.dsh-sh-select{height:26px;max-width:180px;padding:0 6px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;font-size:12px;flex:none;cursor:pointer}',
			'.dsh-sh-select:focus{outline:none;border-color:var(--dsw-alias-border-l2)}',
			'.dsh-sh-chip{flex:none;max-width:140px;height:20px;padding:0 8px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}',
			'.dsh-sh-chip:hover{border-color:var(--dsw-alias-link);color:var(--dsw-alias-link)}',
			'.dsh-sh-body{flex:1;min-height:0;overflow-y:auto;padding:6px 16px 40px}',
			'.dsh-sh-group{margin-top:6px}',
			'.dsh-sh-group-head{display:flex;align-items:center;gap:6px;height:30px;position:sticky;top:0;z-index:1;background:var(--dsw-alias-bg-base);border-radius:6px}',
			'.dsh-sh-group-toggle{flex:1;min-width:0;display:flex;align-items:center;gap:6px;height:30px;padding:0 8px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;font-weight:600;text-align:left;cursor:pointer}',
			'.dsh-sh-group-toggle:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
			'.dsh-sh-group-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:62%}',
			'.dsh-sh-group-count{font-weight:400;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
			'.dsh-sh-group-actions{display:flex;gap:2px;flex:none;opacity:0;transition:opacity .12s ease}',
			'.dsh-sh-group:hover .dsh-sh-group-actions,.dsh-sh-group-actions:focus-within{opacity:1}',
			'.dsh-sh-link{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;padding:3px 6px;border-radius:5px;cursor:pointer}',
			'.dsh-sh-link:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
			'.dsh-sh-link.is-danger:hover{color:var(--dsw-alias-state-error-primary)}',
			'.dsh-sh-rows{display:flex;flex-direction:column}',
			'.dsh-sh-row{display:flex;align-items:center;gap:4px;position:relative}',
			'.dsh-sh-row-main{flex:1;min-width:0;display:flex;align-items:center;gap:9px;height:32px;padding:0 8px;border:none;border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:13px;text-align:left;cursor:pointer}',
			'.dsh-sh-row-main:hover{background:var(--dsw-alias-bg-layer-2)}',
			'.dsh-sh-row-main:disabled{cursor:default;color:var(--dsw-alias-label-secondary)}',
			'.dsh-sh-row-main:disabled:hover{background:transparent}',
			'.dsh-sh-row-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.dsh-sh-dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-state-idle-primary)}',
			'.dsh-sh-dot.is-running{background:var(--dsw-alias-state-success-primary)}',
			'.dsh-sh-dot.is-archived{background:var(--dsw-alias-border-l2)}',
			'.dsh-sh-pin{display:flex;flex:none;color:var(--dsw-alias-brand-primary);opacity:.9}',
			'.dsh-sh-row-meta{display:flex;align-items:center;gap:10px;flex:none;max-width:52%;font-size:12px;color:var(--dsw-alias-label-secondary)}',
			'.dsh-sh-row-ws{max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.85}',
			'.dsh-sh-row-time{font-variant-numeric:tabular-nums;white-space:nowrap}',
			'.dsh-sh-badge{flex:none;font-size:11px;padding:1px 5px;border-radius:4px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}',
			'.dsh-sh-row-action{flex:none;display:flex;align-items:center;justify-content:center;width:22px;height:22px;border:none;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;opacity:0}',
			'.dsh-sh-row:hover .dsh-sh-row-action,.dsh-sh-row-action:focus-visible{opacity:1}',
			'.dsh-sh-row-action:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
			'.dsh-sh-inline-input{width:100%;height:26px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;font-size:12px}',
			'.dsh-sh-inline-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}',
			'.dsh-sh-draft{padding:4px 8px 8px}',
			'.dsh-sh-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:80px 20px;text-align:center;color:var(--dsw-alias-label-secondary)}',
			'.dsh-sh-empty-title{font-size:13px;color:var(--dsw-alias-label-primary)}',
			'.dsh-sh-empty-hint{font-size:12px}',
			'.dsh-sh-backdrop{position:fixed;inset:0;z-index:50;background:transparent}',
			'.dsh-sh-menu{position:fixed;z-index:51;min-width:180px;max-width:260px;max-height:320px;overflow-y:auto;padding:4px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);box-shadow:0 8px 24px var(--dsw-alias-border-l2)}',
			'.dsh-sh-menu-title{font-size:11px;color:var(--dsw-alias-label-secondary);padding:4px 8px 6px}',
			'.dsh-sh-menu-item{display:block;width:100%;text-align:left;border:none;background:transparent;color:inherit;font:inherit;font-size:12px;padding:6px 8px;border-radius:6px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.dsh-sh-menu-item:hover{background:var(--dsw-alias-bg-layer-2)}',
			'.dsh-sh-menu-item.is-active{color:var(--dsw-alias-brand-primary)}',
			'.dsh-sh-menu-item.is-accent{color:var(--dsw-alias-brand-primary)}',
			'.dsh-sh-menu-sep{height:1px;margin:4px 2px;background:var(--dsw-alias-border-l1)}',
			'.dsh-sh-menu-form{padding:2px 4px 4px}'
		].join('\n')

		/* ------------------------------------------------------------------ *
		 * 页面
		 * ------------------------------------------------------------------ */

		/**
		 * 「历史会话」页签的内容。
		 *
		 * @param {object} props 槽位运行时 props（含标准 hook、`sessionId`、`openView`、
		 *   本插件注入的 `openSession` / `translate`）
		 * @returns {import('react').ReactElement} 页面元素
		 */
		function HistoryView(props) {
			// 优先用本插件注入的翻译函数（生命周期完全由我们掌握），
			// 其次用注册时 `locale` 绑定好的 `t`。
			const t = typeof props.translate === 'function' ? props.translate : props.t
			const useSessions = props.useSessions
			const useWorkspaces = props.useWorkspaces

			const [view, setView] = React.useState(readView)
			const [query, setQuery] = React.useState('')
			const [showArchived, setShowArchived] = React.useState(false)
			const [drafting, setDrafting] = React.useState(false)
			const [draftName, setDraftName] = React.useState('')
			const [renaming, setRenaming] = React.useState(null)
			const [renameValue, setRenameValue] = React.useState('')
			const [menu, setMenu] = React.useState(null)
			const [menuCreating, setMenuCreating] = React.useState(false)
			const [menuName, setMenuName] = React.useState('')
			const [notice, setNotice] = React.useState(null)
			const [groupFilter, setGroupFilter] = React.useState('')

			// 两份快照都由框架投影好并复用引用：这里只取用，不自己折叠会话事件。
			// （hooks 的调用与否只取决于槽位是否给了标准 props，跨渲染保持一致。）
			const list = typeof useSessions === 'function' ? useSessions((snapshot) => snapshot) : EMPTY_LIST
			const workspaces =
				typeof useWorkspaces === 'function' ? useWorkspaces((snapshot) => snapshot) : EMPTY_WORKSPACES

			React.useEffect(() => {
				writeView(view)
			}, [view])

			// 操作反馈只留一小会儿：状态每次都是新对象，重复同一句也会重新计时。
			React.useEffect(() => {
				if (notice === null) return
				const timer = setTimeout(() => setNotice(null), 2600)
				return () => clearTimeout(timer)
			}, [notice])

			// 目标会话挂载本视图时切回「对话」，避免"点了却是同一张列表"。
			React.useEffect(() => {
				const pending = pendingOpen
				if (pending === null) return
				if (Date.now() - pending.at > PENDING_TTL_MS) {
					pendingOpen = null
					return
				}
				if (pending.id !== String(props.sessionId)) {
					// 本视图挂在别的会话上，说明导航没有落到目标会话的历史视图，标记作废。
					pendingOpen = null
					return
				}
				pendingOpen = null
				try {
					props.openView(CHAT_VIEW_ID, '')
				} catch {}
			}, [props.sessionId])

			const rows = React.useMemo(() => buildRows(list, workspaces), [list, workspaces])

			const needle = query.trim().toLowerCase()
			// 分组筛选只在「按分组」页生效；分组被删掉时自动失效，避免空列表锁死。
			const activeFilter =
				view.mode === 'custom' && view.groups.some((group) => group.id === groupFilter)
					? groupFilter
					: ''

			const visible = rows.filter((row) => {
				if (!showArchived && row.archived) return false
				if (activeFilter !== '' && view.assignments[row.id] !== activeFilter) return false
				if (needle === '') return true
				const title = row.title === '' ? t('untitled') : row.title
				return (
					title.toLowerCase().indexOf(needle) !== -1 ||
					row.workspaceTitle.toLowerCase().indexOf(needle) !== -1
				)
			})

			const groups = buildGroups(visible, workspaces, view, t)
			const workspaceCount =
				workspaces !== null && workspaces !== undefined && Array.isArray(workspaces.items)
					? workspaces.items.length
					: 0

			/**
			 * 打开一条历史会话：当前会话就直接回到对话页签，否则导航过去。
			 * @param {object} row 行数据
			 */
			const open = (row) => {
				if (row.archived) return
				if (row.id === String(props.sessionId)) {
					try {
						props.openView(CHAT_VIEW_ID, '')
					} catch {}
					return
				}
				pendingOpen = { id: row.id, at: Date.now() }
				try {
					props.openSession(row.id)
				} catch {
					pendingOpen = null
				}
			}

			const setMode = (mode) => {
				// 手动换分组方式时清掉筛选：否则切回来会莫名其妙只剩一组。
				setGroupFilter('')
				setView((current) => ({ ...current, mode }))
			}

			/**
			 * 选中一个分组：记住筛选，并展开这个分组，避免选中后看到的是一个折叠的标题。
			 * @param {string} groupId 分组 id，空串表示「全部分组」
			 */
			const selectGroup = (groupId) => {
				setGroupFilter(groupId)
				if (groupId === '') return
				setView((current) => ({
					...current,
					collapsed: { ...current.collapsed, ['c:' + groupId]: false }
				}))
			}

			/**
			 * 找到这条会话所属的分组。
			 * @param {object} row 行数据
			 * @returns {object|null} 分组定义，未分类或分组已删除时返回 null
			 */
			const groupOf = (row) => {
				const assigned = view.assignments[row.id]
				if (typeof assigned !== 'string' || assigned === '') return null
				for (const group of view.groups) {
					if (group.id === assigned) return group
				}
				return null
			}

			const toggleGroup = (key) =>
				setView((current) => ({
					...current,
					collapsed: { ...current.collapsed, [key]: current.collapsed[key] !== true }
				}))

			const createGroup = () => {
				const name = draftName.trim()
				setDrafting(false)
				setDraftName('')
				if (name === '') return
				setView((current) => ({
					...current,
					groups: current.groups.concat([{ id: newGroupId(), name }])
				}))
			}

			const renameGroup = (groupId, name) => {
				const next = typeof name === 'string' ? name.trim() : ''
				setRenaming(null)
				if (next === '') return
				setView((current) => ({
					...current,
					groups: current.groups.map((group) => (group.id === groupId ? { ...group, name: next } : group))
				}))
			}

			const deleteGroup = (group) => {
				let confirmed = false
				try {
					confirmed = window.confirm(t('confirm.delete', { name: group.label }))
				} catch {
					confirmed = true
				}
				if (!confirmed) return
				setView((current) => {
					const assignments = { ...current.assignments }
					for (const [sessionId, groupId] of Object.entries(assignments)) {
						if (groupId === group.id) delete assignments[sessionId]
					}
					return {
						...current,
						groups: current.groups.filter((entry) => entry.id !== group.id),
						assignments
					}
				})
			}

			const assign = (sessionId, groupId) => {
				setView((current) => {
					const assignments = { ...current.assignments }
					if (groupId === '') delete assignments[sessionId]
					else assignments[sessionId] = groupId
					return { ...current, assignments }
				})
			}

			/** 关掉移动菜单，并清掉菜单里可能残留的"新建分组"输入态。 */
			const closeMenu = () => {
				setMenu(null)
				setMenuCreating(false)
				setMenuName('')
			}

			/**
			 * 把会话移入某个已有分组。
			 * @param {string} sessionId 会话 id
			 * @param {string} groupId 分组 id，空串表示移回未分组
			 * @param {string} label 分组显示名，用于操作反馈
			 */
			const moveToGroup = (sessionId, groupId, label) => {
				assign(sessionId, groupId)
				// 按分组页里行会立刻跳到目标组，本身就是反馈；但若正被筛选，行会直接消失，
				// 这时需要一句提示说明它去哪了。
				if (view.mode !== 'custom' || activeFilter !== '') {
					setNotice({
						text: groupId === '' ? t('notice.ungrouped') : t('notice.moved', { name: label })
					})
				}
				closeMenu()
			}

			/** 在移动菜单里新建一个分组，并把这行的会话直接移进去。 */
			const createGroupFromMenu = () => {
				const target = menu
				const name = menuName.trim()
				setMenuCreating(false)
				setMenuName('')
				if (target === null) return
				if (name === '') {
					closeMenu()
					return
				}
				const groupId = newGroupId()
				setView((current) => ({
					...current,
					groups: current.groups.concat([{ id: groupId, name }]),
					assignments: { ...current.assignments, [target.id]: groupId }
				}))
				setNotice({ text: t('notice.moved', { name }) })
				setMenu(null)
			}

			/** 一组的分组头。 */
			const renderGroupHead = (group) => {
				if (renaming === group.key) {
					return h(
						'div',
						{ className: 'dsh-sh-group-head' },
						h('input', {
							className: 'dsh-sh-inline-input',
							autoFocus: true,
							value: renameValue,
							'aria-label': t('group.renamePlaceholder'),
							onChange: (event) => setRenameValue(event.target.value),
							onKeyDown: (event) => {
								if (event.key === 'Enter') {
									event.preventDefault()
									renameGroup(group.groupId, renameValue)
								} else if (event.key === 'Escape') {
									event.preventDefault()
									setRenaming(null)
								}
							},
							onBlur: () => renameGroup(group.groupId, renameValue)
						})
					)
				}
				const collapsed = view.collapsed[group.key] === true
				return h(
					'div',
					{ className: 'dsh-sh-group-head' },
					h(
						'button',
						{
							type: 'button',
							className: 'dsh-sh-group-toggle',
							'aria-expanded': !collapsed,
							onClick: () => toggleGroup(group.key)
						},
						h(Chevron, { open: !collapsed }),
						h('span', { className: 'dsh-sh-group-name' }, group.label),
						h('span', { className: 'dsh-sh-group-count' }, String(group.rows.length))
					),
					group.custom
						? h(
								'div',
								{ className: 'dsh-sh-group-actions' },
								h(
									'button',
									{
										type: 'button',
										className: 'dsh-sh-link',
										onClick: () => {
											setRenaming(group.key)
											setRenameValue(group.label)
										}
									},
									t('action.rename')
								),
								h(
									'button',
									{ type: 'button', className: 'dsh-sh-link is-danger', onClick: () => deleteGroup(group) },
									t('action.delete')
								)
							)
						: null
				)
			}

			/** 一行会话。 */
			const renderRow = (row) => {
				const title = row.title === '' ? t('untitled') : row.title
				// 三种分组方式下都能把会话归类，所以始终读一次归属，用于菜单里的高亮。
				const assigned = view.assignments[row.id]
				const current = typeof assigned === 'string' ? assigned : ''
				// 按分组页里由分组标题说明归属，其他页才在行内显示可点击的分组名。
				const tag = view.mode === 'custom' ? null : groupOf(row)
				return h(
					'div',
					{ key: row.id, className: 'dsh-sh-row' },
					h(
						'button',
						{
							type: 'button',
							className: 'dsh-sh-row-main',
							disabled: row.archived,
							title: row.archived ? title + ' · ' + t('archive.badge') : title,
							onClick: () => open(row)
						},
						h('span', {
							className:
								'dsh-sh-dot' + (row.running ? ' is-running' : '') + (row.archived ? ' is-archived' : '')
						}),
						h('span', { className: 'dsh-sh-row-title' }, title),
						row.pinned ? h('span', { className: 'dsh-sh-pin', title: t('pinned') }, h(PinGlyph)) : null,
						h(
							'span',
							{ className: 'dsh-sh-row-meta' },
							view.mode !== 'workspace' && row.workspaceTitle !== ''
								? h('span', { className: 'dsh-sh-row-ws' }, row.workspaceTitle)
								: null,
							h('span', { className: 'dsh-sh-row-time' }, relativeTime(row.updatedAt, t))
						)
					),
					row.archived ? h('span', { className: 'dsh-sh-badge' }, t('archive.badge')) : null,
					tag !== null
						? h(
								'button',
								{
									type: 'button',
									className: 'dsh-sh-chip',
									title: t('action.filterByGroup'),
									'aria-label': tag.name + ' · ' + t('action.filterByGroup'),
									onClick: () => {
										// 跳到「按分组」并只留这一组，同时把它展开。
										setView((current) => ({ ...current, mode: 'custom' }))
										selectGroup(tag.id)
									}
								},
								tag.name
							)
						: null,
					h(
						'button',
						{
							type: 'button',
							className: 'dsh-sh-row-action',
							title: t('action.move'),
							'aria-label': t('action.move'),
							onClick: (event) => {
								const rect = event.currentTarget.getBoundingClientRect()
								setMenuCreating(false)
								setMenuName('')
								setMenu({
									id: row.id,
									group: current,
									left: rect.left,
									top: rect.bottom + 4
								})
							}
						},
						h(MoveGlyph)
					)
				)
			}

			/** 分组方式切换按钮。 */
			const modeButton = (mode, label) =>
				h(
					'button',
					{ type: 'button', 'aria-pressed': view.mode === mode, onClick: () => setMode(mode) },
					label
				)

			const empty = groups.length === 0
			// 空状态的措辞要分三种：搜不到 / 该分组下没有可见会话 / 一条会话都还没有。
			const emptyKind = needle !== '' ? 'search' : activeFilter !== '' ? 'group' : 'none'
			const emptyTitle =
				emptyKind === 'search' ? t('empty.search') : emptyKind === 'group' ? t('empty.group') : t('empty.none')
			const emptyHint =
				emptyKind === 'search'
					? t('empty.searchHint')
					: emptyKind === 'group'
						? t('empty.groupHint')
						: t('empty.noneHint')
			const menuStyle =
				menu === null
					? null
					: {
							left: Math.max(8, Math.min(menu.left, (window.innerWidth || 1024) - 268)),
							top: Math.min(menu.top, (window.innerHeight || 768) - 200)
						}

			return h(
				'div',
				{ className: 'dsh-sh-root' },
				h('style', null, CSS),
				h(
					'div',
					{ className: 'dsh-sh-toolbar' },
					h(
						'div',
						{ className: 'dsh-sh-search-wrap' },
						h(SearchGlyph),
						h('input', {
							className: 'dsh-sh-search',
							type: 'search',
							value: query,
							placeholder: t('search.placeholder'),
							'aria-label': t('search.placeholder'),
							onChange: (event) => setQuery(event.target.value)
						})
					),
					h(
						'div',
						{ className: 'dsh-sh-seg', role: 'group', 'aria-label': t('view.label') },
						modeButton('workspace', t('mode.workspace')),
						modeButton('time', t('mode.time')),
						modeButton('custom', t('mode.custom'))
					),
					h(
						'label',
						{ className: 'dsh-sh-check' },
						h('input', {
							type: 'checkbox',
							checked: showArchived,
							onChange: (event) => setShowArchived(event.target.checked)
						}),
						h('span', null, t('action.showArchived'))
					),
					view.mode === 'custom' && view.groups.length > 0
						? h(
								'select',
								{
									className: 'dsh-sh-select',
									value: activeFilter,
									'aria-label': t('filter.label'),
									title: t('filter.label'),
									onChange: (event) => selectGroup(event.target.value)
								},
								h('option', { value: '' }, t('filter.all')),
								view.groups.map((group) => h('option', { key: group.id, value: group.id }, group.name))
							)
						: null,
					view.mode === 'custom'
						? h(
								'button',
								{ type: 'button', className: 'dsh-sh-btn', onClick: () => setDrafting(true) },
								t('action.newGroup')
							)
						: null,
					notice !== null ? h('span', { className: 'dsh-sh-notice', role: 'status' }, notice.text) : null,
					h(
						'span',
						{ className: 'dsh-sh-count' },
						t('count.summary', { sessions: String(visible.length), workspaces: String(workspaceCount) })
					)
				),
				h(
					'div',
					{ className: 'dsh-sh-body' },
					drafting
						? h(
								'div',
								{ className: 'dsh-sh-draft' },
								h('input', {
									className: 'dsh-sh-inline-input',
									autoFocus: true,
									value: draftName,
									placeholder: t('group.newPlaceholder'),
									'aria-label': t('group.newPlaceholder'),
									onChange: (event) => setDraftName(event.target.value),
									onKeyDown: (event) => {
										if (event.key === 'Enter') {
											event.preventDefault()
											createGroup()
										} else if (event.key === 'Escape') {
											event.preventDefault()
											setDrafting(false)
											setDraftName('')
										}
									},
									onBlur: createGroup
								})
							)
						: null,
					empty
						? h(
								'div',
								{ className: 'dsh-sh-empty' },
								h(EmptyGlyph),
								h('div', { className: 'dsh-sh-empty-title' }, emptyTitle),
								h('div', { className: 'dsh-sh-empty-hint' }, emptyHint)
							)
						: groups.map((group) =>
								h(
									'section',
									{ key: group.key, className: 'dsh-sh-group' },
									renderGroupHead(group),
									view.collapsed[group.key] === true
										? null
										: h('div', { className: 'dsh-sh-rows' }, group.rows.map(renderRow))
								)
							)
				),
				menu !== null
					? h(
							'div',
							{ className: 'dsh-sh-menu', style: menuStyle, onClick: (event) => event.stopPropagation() },
							h('div', { className: 'dsh-sh-menu-title' }, t('action.move')),
							menuCreating
								? h(
										'div',
										{ className: 'dsh-sh-menu-form' },
										h('input', {
											className: 'dsh-sh-inline-input',
											autoFocus: true,
											value: menuName,
											placeholder: t('group.newPlaceholder'),
											'aria-label': t('group.newPlaceholder'),
											onChange: (event) => setMenuName(event.target.value),
											onKeyDown: (event) => {
												if (event.key === 'Enter') {
													event.preventDefault()
													createGroupFromMenu()
												} else if (event.key === 'Escape') {
													event.preventDefault()
													closeMenu()
												}
											}
										})
									)
								: [
										...view.groups.map((group) =>
											h(
												'button',
												{
													key: group.id,
													type: 'button',
													className: 'dsh-sh-menu-item' + (menu.group === group.id ? ' is-active' : ''),
													onClick: () => moveToGroup(menu.id, group.id, group.name)
												},
												group.name
											)
										),
										view.groups.length > 0
											? h(
													'button',
													{
														key: '__ungrouped',
														type: 'button',
														className: 'dsh-sh-menu-item' + (menu.group === '' ? ' is-active' : ''),
														onClick: () => moveToGroup(menu.id, '', '')
													},
													t('group.ungrouped')
												)
											: null,
										h('div', { key: '__sep', className: 'dsh-sh-menu-sep' }),
										h(
											'button',
											{
												key: '__new',
												type: 'button',
												className: 'dsh-sh-menu-item is-accent',
												onClick: () => {
													setMenuCreating(true)
													setMenuName('')
												}
											},
											t('action.createAndMove')
										)
									]
						)
					: null,
				menu !== null ? h('div', { className: 'dsh-sh-backdrop', onClick: closeMenu }) : null
			)
		}

		/* ------------------------------------------------------------------ *
		 * 插件体
		 * ------------------------------------------------------------------ */

		/** 需要的客户端服务。 */
		const inject = ['slots', 'locale', 'uiWorkspace']

		/**
		 * 注册「历史会话」页签。
		 * @param {object} ctx 客户端根 context
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-session-history: dictionaries')

			const t = ctx.locale.bind(NS)

			/**
			 * 打开一条会话（UI 侧唯一的数据动作）。
			 * @param {string} sessionId 目标会话
			 */
			const openSession = (sessionId) => {
				ctx.uiWorkspace.openSession(sessionId)
			}

			ctx.slots.inject('conversation.view', () =>
				ctx.slots.register(
					{
						name: 'conversation.view',
						id: VIEW_ID,
						order: 40,
						locale: NS,
						label: () => t('view.label'),
						inject: () => ({ openSession, translate: t })
					},
					HistoryView
				)
			)
		}

		return { apply, inject }
	}
})

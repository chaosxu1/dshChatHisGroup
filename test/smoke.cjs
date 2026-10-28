/**
 * dsh-session-history 冒烟测试（不启动浏览器）。
 *
 * 用极简 React 假实现 + 可记录的 setState，既验证渲染结果，也能直接调用
 * 控件的 onChange / onClick 来断言交互逻辑（选组自动展开、全局筛选持久化等）。
 */
const fs = require('fs')
const vm = require('vm')

const CLIENT = process.argv[2]
if (!CLIENT) throw new Error('usage: node test/smoke.cjs <client.js>')
const source = fs.readFileSync(CLIENT, 'utf8')

/* ---------------- 极简 React ---------------- */
let stateValues = []
let stateIndex = 0
let setterCalls = []

function flatten(children) {
	const out = []
	for (const child of children) {
		if (Array.isArray(child)) out.push(...flatten(child))
		else out.push(child)
	}
	return out
}

const React = {
	createElement(type, props, ...children) {
		return { type, props: props || {}, children: flatten(children) }
	},
	useState(init) {
		const index = stateIndex++
		const value =
			stateValues[index] !== undefined ? stateValues[index] : typeof init === 'function' ? init() : init
		return [value, (arg) => setterCalls.push({ index, arg })]
	},
	useEffect() {},
	useMemo(fn) {
		return fn()
	}
}

/* ---------------- window 桩 ---------------- */
let stored = null
const window = {
	__ModuleLoader__: {
		load(config) {
			window.captured = config
		}
	},
	localStorage: {
		getItem() {
			return stored
		},
		setItem(key, value) {
			stored = value
		}
	},
	innerWidth: 1280,
	innerHeight: 800,
	confirm: () => true
}

const sandbox = {
	window,
	console,
	Date,
	Math,
	JSON,
	Set,
	Map,
	Object,
	Array,
	String,
	Number,
	Boolean,
	RegExp,
	setTimeout,
	clearTimeout,
	requestAnimationFrame: (fn) => fn()
}
sandbox.globalThis = sandbox
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: CLIENT })

/* ---------------- 插件体 ---------------- */
const dictionaries = {}
const ctx = {
	effect(fn) {
		return fn()
	},
	locale: {
		register(ns, dicts) {
			dictionaries[ns] = dicts
			return () => {}
		},
		bind(ns) {
			return (key, params) => {
				const template = dictionaries[ns].zh[key]
				if (template === undefined) throw new Error('missing locale key: ' + key)
				if (params === undefined) return template
				return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name]))
			}
		}
	},
	slots: {
		inject(key, callback) {
			return callback()
		},
		register(options, component) {
			ctx.registered = { options, component }
			return () => {}
		}
	},
	uiWorkspace: { openSession() {} }
}

const moduleExports = window.captured.factory((name) => {
	if (name === 'react') return React
	throw new Error('unexpected require: ' + name)
})
if (moduleExports.inject.indexOf('slots') === -1) throw new Error('inject list missing slots')
moduleExports.apply(ctx)

const registration = ctx.registered
if (registration === undefined) throw new Error('nothing registered')
if (registration.options.id !== 'history') throw new Error('wrong view id')
if (registration.options.order !== 40) throw new Error('wrong order')
if (registration.options.label() !== '历史会话') throw new Error('wrong label')

/* ---------------- 测试数据 ---------------- */
const list = {
	ids: ['s1', 's2', 's3', 's4', 's5', 's6'],
	byId: {
		s1: { id: 's1', title: '验证 web_fetch 可用性', updatedAt: Date.now() - 60000, running: true, blank: false },
		s2: { id: 's2', title: '子代理会话', updatedAt: Date.now(), origin: 'subagent', blank: false },
		s3: { id: 's3', title: '', displayTitle: 's3', updatedAt: Date.now(), blank: true },
		s4: { id: 's4', title: '', displayTitle: 'note-tools', updatedAt: Date.now() - 90 * 86400000, blank: false },
		s5: { id: 's5', title: '已归档的会话', updatedAt: Date.now() - 3 * 86400000, blank: false },
		s6: { id: 's6', title: '无工作区会话', updatedAt: Date.now() - 3600000, blank: false }
	}
}

const workspaces = {
	items: [
		{ workspaceId: 'w1', path: 'X:\\Obsidian\\OrbitOS\\WorkAuto', title: '', sessionIds: ['s1', 's2'] },
		{ workspaceId: 'w2', path: 'X:\\work\\projects\\alpha', title: 'Alpha 项目', sessionIds: ['s4', 's5'] }
	],
	archivedSessionIds: ['s5'],
	pinnedSessionIds: ['s1']
}

/* ---------------- 渲染与遍历 ----------------
 * 状态顺序：0 view / 1 query / 2 drafting / 3 draftName / 4 renaming /
 *           5 renameValue / 6 menu / 7 menuCreating / 8 menuName / 9 notice
 * 视图偏好（mode / filter / showArchived / ...）走 localStorage 里的 view，
 * 测试通过 viewJson 参数注入，更接近"全局设置"的真实来源。
 */
function render(stateInit, viewJson) {
	stored = viewJson === undefined ? null : JSON.stringify(viewJson)
	stateValues = stateInit || []
	stateIndex = 0
	setterCalls = []
	const props = {
		translate: ctx.locale.bind('dsh.session-history'),
		useSessions: (selector) => selector(list),
		useWorkspaces: (selector) => selector(workspaces),
		sessionId: 's1',
		openView: () => {},
		openSession: () => {}
	}
	return registration.component(props)
}

function textOf(node) {
	if (node === null || node === undefined) return ''
	if (typeof node === 'string' || typeof node === 'number') return String(node)
	if (Array.isArray(node)) return node.map(textOf).join('\n')
	if (typeof node === 'object') {
		if (node.type === 'style') return ''
		return textOf(node.children) + ' ' + JSON.stringify(node.props)
	}
	return ''
}

function collect(node, out) {
	const nodes = out || []
	if (node === null || node === undefined) return nodes
	if (Array.isArray(node)) {
		for (const child of node) collect(child, nodes)
		return nodes
	}
	if (typeof node !== 'object') return nodes
	nodes.push(node)
	collect(node.children, nodes)
	return nodes
}

function pressedModes(tree) {
	const labels = []
	for (const node of collect(tree)) {
		if (node.props !== undefined && node.props['aria-pressed'] === true) labels.push(textOf(node.children).trim())
	}
	return labels
}

/** 依次应用记录到的 setState 更新，模拟 React 的状态演进。 */
function replay(initial) {
	let state = initial
	for (const call of setterCalls) {
		if (typeof call.arg === 'function') state = call.arg(state)
	}
	return state
}

const baseView = (patch) =>
	Object.assign(
		{ mode: 'workspace', collapsed: {}, groups: [], assignments: {}, filter: '', showArchived: false },
		patch || {}
	)

/* ---------------- 用例 1：默认按工作区 ---------------- */
let tree = render()
let text = textOf(tree)
if (text.includes('子代理会话')) throw new Error('case1: subagent session must be hidden')
if (text.includes('未命名会话')) throw new Error('case1: blank session must be hidden')
if (text.includes('已归档的会话')) throw new Error('case1: archived hidden by default')
if (!text.includes('验证 web_fetch 可用性')) throw new Error('case1: missing s1')
if (!text.includes('WorkAuto')) throw new Error('case1: missing workspace basename group')
if (!text.includes('Alpha 项目')) throw new Error('case1: missing workspace title group')
if (!text.includes('note-tools')) throw new Error('case1: displayTitle fallback missing')
if (!text.includes('无工作区会话')) throw new Error('case1: ungrouped session missing')
if (!text.includes('3 个会话 · 2 个工作区')) throw new Error('case1: wrong summary count')
let modes = pressedModes(tree)
if (modes.length !== 1 || modes[0] !== '按工作区') throw new Error('case1: wrong default mode ' + modes.join(','))

/* ---------------- 用例 2：显示已归档（来自持久化视图偏好） ---------------- */
tree = render([], baseView({ showArchived: true }))
text = textOf(tree)
if (!text.includes('已归档的会话')) throw new Error('case2: archived row missing')
if (!text.includes('已归档')) throw new Error('case2: archived badge missing')

/* ---------------- 用例 3：按时间 ---------------- */
tree = render([], baseView({ mode: 'time', showArchived: true }))
text = textOf(tree)
for (const bucket of ['今天', '近 7 天', '更早']) {
	if (!text.includes(bucket)) throw new Error('case3: missing bucket ' + bucket)
}
if (!pressedModes(tree).includes('按时间')) throw new Error('case3: mode not reflected')

/* ---------------- 用例 4：按分组 ---------------- */
const customView = baseView({
	mode: 'custom',
	groups: [
		{ id: 'g1', name: '笔记工程' },
		{ id: 'g2', name: '空分组' }
	],
	assignments: { s1: 'g1', s6: 'g1' }
})
tree = render([], customView)
text = textOf(tree)
if (!text.includes('笔记工程')) throw new Error('case4: custom group missing')
const emptyMentions = text.split('空分组').length - 1
if (emptyMentions !== 1) throw new Error('case4: empty group must not render a section (' + emptyMentions + ')')
if (!text.includes('note-tools')) throw new Error('case4: unassigned session must stay ungrouped')
if (!text.includes('移动到分组')) throw new Error('case4: move action missing')

/* ---------------- 用例 5：搜索 ---------------- */
tree = render([undefined, 'alpha'])
text = textOf(tree)
if (!text.includes('note-tools')) throw new Error('case5: workspace match must survive')
if (text.includes('验证 web_fetch 可用性')) throw new Error('case5: non-matching row must be filtered')

tree = render([undefined, 'zzz'])
if (!textOf(tree).includes('没有匹配的会话')) throw new Error('case5: empty search state missing')

/* ---------------- 用例 6：折叠 ---------------- */
tree = render([], baseView({ collapsed: { 'w:w1': true } }))
text = textOf(tree)
if (text.includes('验证 web_fetch 可用性')) throw new Error('case6: collapsed group must hide rows')
if (!text.includes('WorkAuto')) throw new Error('case6: collapsed header must stay')

/* ---------------- 用例 7：按时间页的行内分组标签 ---------------- */
const timeView = baseView({ mode: 'time', groups: [{ id: 'g1', name: '笔记工程' }], assignments: { s1: 'g1' } })
tree = render([], timeView)
text = textOf(tree)
if (!text.includes('dsh-sh-chip')) throw new Error('case7: chip missing in time mode')
if (!text.includes('只看这个分组')) throw new Error('case7: chip action label missing')

/* ---------------- 用例 8：移动菜单 ---------------- */
tree = render([undefined, '', false, '', null, '', { id: 's1', group: '', left: 20, top: 20 }], timeView)
text = textOf(tree)
if (!text.includes('笔记工程')) throw new Error('case8: group missing from menu')
if (!text.includes('未分组')) throw new Error('case8: ungrouped choice missing')
if (!text.includes('新建分组并移入')) throw new Error('case8: create entry missing')

/* ---------------- 用例 9：菜单里的新建输入 ---------------- */
tree = render(
	[undefined, '', false, '', null, '', { id: 's1', group: '', left: 20, top: 20 }, true, ''],
	timeView
)
text = textOf(tree)
if (!text.includes('分组名称，回车创建')) throw new Error('case9: inline input missing')
if (text.includes('新建分组并移入')) throw new Error('case9: entry list should be replaced')

/* ---------------- 用例 10：无分组时不显示无意义的"未分组" ---------------- */
tree = render(
	[undefined, '', false, '', null, '', { id: 's1', group: '', left: 20, top: 20 }],
	baseView({ mode: 'time' })
)
text = textOf(tree)
if (!text.includes('新建分组并移入')) throw new Error('case10: create entry missing')
if (text.includes('dsh-sh-menu-item is-active')) throw new Error('case10: ungrouped item should be omitted')

/* ---------------- 用例 11：按组筛选（来自持久化偏好） ---------------- */
tree = render([], baseView(Object.assign({}, customView, { filter: 'g1' })))
text = textOf(tree)
if (!text.includes('全部分组')) throw new Error('case11: filter select missing')
if (text.includes('note-tools')) throw new Error('case11: other sessions must be filtered out')
if (text.includes('dsh-sh-chip')) throw new Error('case11: chip must not render in custom mode')

/* ---------------- 用例 12：筛选无结果的空状态 ---------------- */
tree = render([], baseView({ mode: 'custom', groups: [{ id: 'g2', name: '空分组' }], filter: 'g2' }))
if (!textOf(tree).includes('这个分组下没有可见会话')) throw new Error('case12: group empty state missing')

/* ---------------- 用例 13：选择分组后自动展开 ---------------- */
const collapsedView = baseView({
	mode: 'custom',
	collapsed: { 'c:g1': true },
	groups: [{ id: 'g1', name: '笔记工程' }],
	assignments: { s1: 'g1' }
})
tree = render([], collapsedView)
if (textOf(tree).includes('验证 web_fetch 可用性')) throw new Error('case13: precondition failed')
const select = collect(tree).find((node) => node.type === 'select')
if (select === undefined) throw new Error('case13: select missing')
select.props.onChange({ target: { value: 'g1' } })
let simulated = replay(collapsedView)
if (simulated.collapsed['c:g1'] !== false) throw new Error('case13: selecting a group must expand it')
if (simulated.filter !== 'g1') throw new Error('case13: filter not stored in view')

/* ---------------- 用例 14：点分组标签切页并展开 ---------------- */
const chipView = baseView({
	mode: 'time',
	collapsed: { 'c:g1': true },
	groups: [{ id: 'g1', name: '笔记工程' }],
	assignments: { s1: 'g1' }
})
tree = render([], chipView)
const chip = collect(tree).find((node) => node.props !== undefined && node.props.className === 'dsh-sh-chip')
if (chip === undefined) throw new Error('case14: chip missing')
chip.props.onClick()
simulated = replay(chipView)
if (simulated.mode !== 'custom') throw new Error('case14: chip must switch view')
if (simulated.filter !== 'g1') throw new Error('case14: chip must store the filter')
if (simulated.collapsed['c:g1'] !== false) throw new Error('case14: chip must expand target group')

/* ---------------- 用例 15：切到另一个会话后，筛选仍是同一组 ----------------
 * 模拟：会话 A 选了分组 g1 → 视图偏好被持久化 → 会话 B 挂载时读到同一份偏好。
 */
const aTree = render([], customView)
const aSelect = collect(aTree).find((node) => node.type === 'select')
aSelect.props.onChange({ target: { value: 'g1' } })
const persisted = replay(customView)
if (persisted.filter !== 'g1') throw new Error('case15: filter not persisted from session A')

const bTree = render([], persisted)
const bText = textOf(bTree)
if (!bText.includes('笔记工程')) throw new Error('case15: session B lost the selected group')
if (bText.includes('note-tools')) throw new Error('case15: session B must stay filtered')
const bSelect = collect(bTree).find((node) => node.type === 'select')
if (bSelect.props.value !== 'g1') {
	throw new Error('case15: select must show the restored group, got ' + bSelect.props.value)
}

/* ---------------- 用例 16：分组方式用下划线而非方框 ---------------- */
if (!source.includes('aria-pressed="true"]::after')) throw new Error('case16: underline indicator missing')
if (source.includes('box-shadow:0 0 0 1px var(--dsw-alias-border-l1)')) {
	throw new Error('case16: old boxed segment style still present')
}
const underlineAt = source.indexOf('aria-pressed="true"]::after')
const underlineRule = source.slice(underlineAt, underlineAt + 300)
if (!underlineRule.includes('--dsw-alias-state-business-primary')) {
	throw new Error('case16: underline must use the host tab accent token, got: ' + underlineRule)
}
if (underlineRule.includes('brand-primary')) throw new Error('case16: brand-primary is near-black in this theme')

const activeAt = source.indexOf('button[aria-pressed="true"]{color:')
if (activeAt < 0) throw new Error('case16: active mode text-color rule missing')
const activeRule = source.slice(activeAt, activeAt + 160)
if (!activeRule.includes('--dsw-alias-state-business-primary')) {
	throw new Error('case16: active mode text must be the tab blue, got: ' + activeRule)
}
if (activeRule.includes('label-primary)')) throw new Error('case16: active text must not fall back to primary label')

console.log('ALL RENDER CASES PASSED (16)')

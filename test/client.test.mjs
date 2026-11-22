import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, Script } from 'node:vm'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** Evaluate client.js with a fake React whose createElement records its arguments: { a: [type, props, ...children] }. */
function load(extra = {}) {
  const loaded = []
  const document = { baseURI: 'http://127.0.0.1:1/', createElement: () => ({ remove() {} }), head: { appendChild() {} } }
  const context = { window: { __ModuleLoader__: { load(entry) { loaded.push(entry) } } }, console: { warn() {}, error() {} }, document, URL, URLSearchParams, Promise, ...extra }
  createContext(context)
  new Script(readFileSync(join(ROOT, 'client.js'), 'utf8')).runInContext(context)
  const react = { createElement: (...a) => ({ a }), useMemo: (f) => f(), useState() {}, useEffect() {}, useRef() {}, useSyncExternalStore() {} }
  const modules = { react, 'react-dom': { createPortal: (n) => n } }
  return loaded[0].factory((name) => modules[name])
}

const j = (value) => JSON.stringify(value) // JSON compare: arrays built inside the vm context are another realm
const sel = (model, reasoningEffort) => ({ projectionValues: { modelSelection: { lastUsed: { provider: 'p', model, reasoningEffort }, next: null } } })
const none = new Set()
const noStatus = new Map()
const identity = (key, fallback) => fallback

test('labelOf shows model and effort, null without a selection', () => {
  const { helpers } = load()
  assert.equal(helpers.labelOf({ model: 'm', reasoningEffort: 'high' }), 'm · high')
  assert.equal(helpers.labelOf({ model: 'm' }), 'm')
  assert.equal(helpers.labelOf(null), null)
})

test('selectionOf prefers lastUsed, falls back to next', () => {
  const { helpers } = load()
  assert.equal(helpers.selectionOf(sel('a')).model, 'a')
  assert.equal(helpers.selectionOf({ projectionValues: { modelSelection: { lastUsed: null, next: { provider: 'p', model: 'n' } } } }).model, 'n')
  assert.equal(helpers.selectionOf({}), null)
})

test('titleOf: catalog label, then session title, then name; never the workspace-folder displayTitle', () => {
  const { helpers } = load()
  assert.equal(helpers.titleOf({ id: 'a', label: 'L', name: 'n' }, { title: 'T' }), 'L')
  assert.equal(helpers.titleOf({ id: 'a', name: 'n' }, { title: 'T' }), 'T')
  assert.equal(helpers.titleOf({ id: 'a', name: 'n' }, { displayTitle: 'my-project' }), 'n')
  assert.equal(helpers.titleOf({ id: 'a' }, undefined), 'a')
})

test('stateOf: external, running (status wins over summary), done, idle', () => {
  const { helpers } = load()
  const done = { projectionValues: { subagentTiming: { lastTurnCompleted: true } } }
  assert.equal(helpers.stateOf({ running: true }, undefined, true), 'external')
  assert.equal(helpers.stateOf({ running: false }, { running: true }, false), 'running')
  assert.equal(helpers.stateOf({ running: true }, undefined, false), 'running')
  assert.equal(helpers.stateOf(done, undefined, false), 'done')
  assert.equal(helpers.stateOf({}, undefined, false), 'idle')
})

test('rowsOf puts running first, then idle, then done, then external; stable inside a group', () => {
  const { helpers } = load()
  const done = { projectionValues: { subagentTiming: { lastTurnCompleted: true } } }
  const byId = { a: done, b: {}, c: done, d: {} }
  const entries = [...['a', 'b', 'c', 'd'].map((id) => ({ id, label: id, mode: 'continuable' })), { id: 'x', mode: 'external' }]
  const rows = helpers.rowsOf(entries, byId, new Map([['d', { running: true }]]), {}, none)
  assert.equal(j(rows.map((r) => [r.entry.id, r.state])), j([['d', 'running'], ['b', 'idle'], ['a', 'done'], ['c', 'done'], ['x', 'external']]))
})

test('rowsOf hides hidden ids and offers no branch made only of hidden children', () => {
  const { helpers } = load()
  const entries = [{ id: 'a', mode: 'continuable' }, { id: 'b', mode: 'continuable' }, { id: 'c', mode: 'continuable' }]
  const catalogs = { a: [{ id: 'x' }], b: [{ id: 'y' }], c: [{ id: 'z' }, { id: 'w' }] }
  const rows = helpers.rowsOf(entries, {}, noStatus, catalogs, new Set(['b', 'x', 'z']))
  assert.equal(j(rows.map((r) => [r.entry.id, r.canExpand])), j([['a', false], ['c', true]]))
})

test('describeRow carries tokens, time, start, secondary line and the navigation address', () => {
  const { helpers } = load()
  const summary = { updatedAt: 5000, projectionValues: { tokenUsage: { uncachedInputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 }, subagentTiming: { settledMs: 1000 } } }
  const [row] = helpers.rowsOf([{ id: 'a', label: 'Nice', name: 'impl-a', mode: 'continuable' }], { a: summary }, noStatus, {}, none)
  const info = helpers.describeRow(row, 'parent', 9000, identity)
  assert.equal(j([info.tokens, info.ms, info.since, info.secondary]), j([10, 1000, 5000, 'impl-a · continuable']))
  assert.equal(j(info.address), j({ parentSessionId: 'parent', childSessionId: 'a', mode: 'continuable' }))
})

test('durationOf: live while running, frozen otherwise, none without timing', () => {
  const { helpers } = load()
  const summary = { projectionValues: { subagentTiming: { settledMs: 1000, active: { since: 5000, through: 7000 } } } }
  assert.equal(helpers.durationOf(summary, 'running', 9000), 5000)
  assert.equal(helpers.durationOf(summary, 'done', 9000), 3000)
  assert.equal(helpers.durationOf({}, 'done', 9000), undefined)
})

test('sinceOf is the session time for every non-external row, nothing for external or a missing time', () => {
  const { helpers } = load()
  assert.equal(helpers.sinceOf({ updatedAt: 7000 }, 'done'), 7000)
  assert.equal(helpers.sinceOf({ updatedAt: 7000 }, 'running'), 7000)
  assert.equal(helpers.sinceOf({ updatedAt: 7000 }, 'external'), undefined)
  assert.equal(helpers.sinceOf({ updatedAt: 0 }, 'done'), undefined)
  assert.equal(helpers.sinceOf(undefined, 'done'), undefined)
})

test('formatters', () => {
  const { helpers } = load()
  assert.equal(helpers.formatTokens(833000), '833K')
  assert.equal(helpers.formatTokens(5300000), '5.3M')
  assert.equal(helpers.formatDuration(6 * 60000 + 46000), '6m 46s')
  assert.equal(helpers.formatClock(new Date(2026, 10, 20, 9, 5).getTime()), '09:05')
  assert.equal(helpers.formatClock(new Date(2026, 10, 20, 16, 30).getTime()), '16:30')
})

test('focusTarget moves one row at a time, wraps, and ignores other keys', () => {
  const { helpers } = load()
  const f = helpers.focusTarget
  assert.deepEqual([f(3, 0, 'ArrowDown'), f(3, 2, 'ArrowDown'), f(3, -1, 'ArrowDown')], [1, 0, 0])
  assert.deepEqual([f(3, 0, 'ArrowUp'), f(3, -1, 'ArrowUp'), f(3, 1, 'ArrowUp')], [2, 2, 0])
  assert.deepEqual([f(3, 1, 'Home'), f(3, 1, 'End'), f(3, 1, 'a'), f(0, 0, 'ArrowDown')], [0, 2, -1, -1])
})

test('keyboard navigation is bound once: the portaled menu has no handler of its own', () => {
  const source = readFileSync(join(ROOT, 'client.js'), 'utf8')
  assert.equal(source.match(/onKeyDown: navigate/g).length, 1)
})

test('walkCatalog lists every descendant once, depth first, and survives cycles', () => {
  const { helpers } = load()
  const catalogs = { r: [{ id: 'a' }, { id: 'b' }], a: [{ id: 'c' }], c: [{ id: 'a' }] }
  assert.equal(helpers.walkCatalog(catalogs, 'r').map((e) => e.id).join(), 'a,c,b')
})

test('Level renders its rows in state order, with a spacer instead of buttons for external rows', () => {
  const { helpers } = load()
  const catalogs = { p: [{ id: 'a', mode: 'continuable' }, { id: 'e', mode: 'external' }, { id: 'b', mode: 'continuable' }] }
  // Level is a plain function (its hooks live in child components), so it can be called directly.
  const props = { parentId: 'p', byId: { a: {}, b: { running: true } }, statuses: noStatus, catalogs, expanded: none, toggle() {}, now: 0, tr: identity, actions: {}, level: 1, close() {}, hidden: none }
  const nodes = helpers.Level(props)
  assert.equal(nodes.map((n) => n.a[1].key).join(), 'b,a,e')
  const classesOf = (node) => JSON.stringify(node).match(/dai-[a-z]+/g)
  assert.ok(classesOf(nodes[2]).includes('dai-spacer'))
  assert.ok(!classesOf(nodes[0]).includes('dai-spacer'))
})

test('the hidden store merges archived ids with gone ids, keeps a stable snapshot and replaces checked ids', () => {
  const { helpers } = load()
  let archived = ['z']
  const workspaces = { list: { getSnapshot: () => ({ archivedSessionIds: archived }), subscribe: () => () => {} } }
  const store = helpers.createHiddenStore(() => workspaces)
  const first = store.getSnapshot()
  assert.equal(first.has('z'), true)
  assert.equal(store.getSnapshot(), first)
  let notified = 0
  store.subscribe(() => { notified += 1 })
  store.update(['a', 'b'], ['a', 'b', 'c'])
  assert.equal(notified, 1)
  assert.equal(j([...store.getSnapshot()].sort()), j(['a', 'b', 'z']))
  store.update(['a', 'b'], ['a', 'b', 'c'])
  assert.equal(notified, 1)
  store.update(['b'], ['a', 'b'])
  assert.equal(j([...store.getSnapshot()].sort()), j(['b', 'z']))
  archived = ['y']
  assert.equal(j([...store.getSnapshot()].sort()), j(['b', 'y']))
  const noService = helpers.createHiddenStore(() => undefined)
  assert.equal(noService.getSnapshot().size, 0)
  assert.equal(noService.getSnapshot(), noService.getSnapshot())
})

test('apply registers under the native id at a lower priority, without declaring children', () => {
  const plugin = load()
  const specs = []
  plugin.apply({
    effect: (f) => f(),
    get: () => undefined,
    slots: { inject: (slot, f) => { specs.push(slot); f() }, register: (spec) => { specs.push(spec); return () => {} } },
  })
  assert.equal(specs[0], 'conversation.session.header.actions')
  assert.equal(specs[1].id, 'subagent-catalog')
  assert.equal(specs[1].priority, -1)
  assert.equal(specs[1].children, undefined)
})

/** Run apply with a fake ctx and return the actions object the registered component carries. */
function actionsOf(fetchImpl, { archivedIds = [], sessions = {} } = {}) {
  const archiveCalls = []
  const plugin = load({ fetch: fetchImpl })
  let component
  plugin.apply({
    effect: (f) => f(),
    get: (name) => (name === 'workspaces' ? { list: { getSnapshot: () => ({ archivedSessionIds: archivedIds }), subscribe: () => () => {} } } : undefined),
    uiWorkspace: { archiveSession: async (id) => { archiveCalls.push(id) } },
    sessions: { refreshProjections: async () => {}, ...sessions },
    slots: { inject: (slot, f) => f(), register: (spec, c) => { component = c; return () => {} } },
  })
  return { actions: component({}).a[1].actions, archiveCalls }
}

const reply = (status, body) => async () => ({ status, ok: status < 400, text: async () => JSON.stringify(body) })
const hasHidden = (actions, id) => actions.hiddenStore.getSnapshot().has(id)

test('checkGone hides the ids the Host reports missing; a failed check hides nothing', async () => {
  const { actions } = actionsOf(reply(200, { missing: ['b'] }))
  await actions.checkGone(['a', 'b'])
  assert.deepEqual([hasHidden(actions, 'a'), hasHidden(actions, 'b')], [false, true])
  const failing = actionsOf(async () => { throw new Error('offline') })
  await failing.actions.checkGone(['a'])
  assert.equal(failing.actions.hiddenStore.getSnapshot().size, 0)
})

test('checkGone replaces what it knew: an id that reappears on disk comes back', async () => {
  let answer = ['b']
  const { actions } = actionsOf(async () => reply(200, { missing: answer })())
  await actions.checkGone(['a', 'b'])
  assert.equal(hasHidden(actions, 'b'), true)
  answer = []
  await actions.checkGone(['a', 'b'])
  assert.equal(hasHidden(actions, 'b'), false)
})

test('an older check that answers after a delete cannot undo it', async () => {
  let release
  const slow = new Promise((resolve) => { release = resolve })
  const { actions } = actionsOf(async (url) => {
    if (url.endsWith('/exists')) { await slow; return reply(200, { missing: [] })() }
    return reply(200, { deleted: 1 })()
  })
  const check = actions.checkGone(['x'])
  await actions.remove('parent', 'x')
  release()
  await check
  assert.equal(hasHidden(actions, 'x'), true)
})

test('remove only posts the delete (the Host archives), then hides the row', async () => {
  const posts = []
  const { actions, archiveCalls } = actionsOf(async (url, init) => { posts.push([url, JSON.parse(init.body)]); return reply(200, { deleted: 1 })() })
  await actions.remove('parent', 'x')
  assert.deepEqual(archiveCalls, [])
  assert.equal(j(posts), j([['/dsh-subagent-panel-plus/delete', { sessionId: 'x' }]]))
  assert.equal(hasHidden(actions, 'x'), true)
})

test('remove: any refusal keeps the row; only 410 (folder gone) hides it', async () => {
  for (const [status, error] of [[404, 'no such session: x'], [409, 'session is running: x'], [403, 'not a subagent session: x'], [500, 'boom']]) {
    const t = actionsOf(reply(status, { error }))
    await assert.rejects(t.actions.remove('parent', 'x'), new RegExp(error.split(':')[0]))
    assert.equal(hasHidden(t.actions, 'x'), false)
  }
  const gone = actionsOf(reply(410, { error: 'session folder not found: x' }))
  await gone.actions.remove('parent', 'x')
  assert.equal(hasHidden(gone.actions, 'x'), true)
})

test('archive goes through dsh without stopping running work', async () => {
  const { actions, archiveCalls } = actionsOf(reply(200, {}))
  await actions.archive('s1')
  assert.deepEqual(archiveCalls, ['s1'])
})

test('an archived id is hidden without any request', () => {
  const { actions } = actionsOf(reply(200, {}), { archivedIds: ['s1'] })
  assert.equal(hasHidden(actions, 's1'), true)
})

test('prepareCatalog refreshes the parent, then each readable child, and skips external or broken ones', async () => {
  const refreshed = []
  const snapshot = {
    byId: { c2: { formatStatus: 'migration-required' } },
    projectionsBySession: {
      p: { state: 'ready', values: { subagentCatalog: [{ id: 'c1', mode: 'continuable' }, { id: 'c2', mode: 'continuable' }, { id: 'c3', mode: 'continuable' }, { id: 'c4', mode: 'external' }] } },
      c3: { state: 'error' },
    },
  }
  const sessions = { refreshProjections: async (id) => { refreshed.push(id) }, list: { getSnapshot: () => snapshot } }
  const { actions } = actionsOf(reply(200, {}), { sessions })
  await actions.prepareCatalog('p')
  assert.deepEqual(refreshed, ['p', 'c1'])
})

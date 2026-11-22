import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createDeleteHandler, createExistsHandler, collectTree, sessionsRoot } from '../host.js'

const ID = '11111111-aaaa-bbbb-cccc-000000000001'
const CHILD = '11111111-aaaa-bbbb-cccc-000000000002'
const OTHER = '11111111-aaaa-bbbb-cccc-000000000003'
const LIVE = '11111111-aaaa-bbbb-cccc-000000000004'

const sub = (sessionId, extra = {}) => ({ sessionId, origin: 'subagent', running: false, ...extra })

/**
 * A fake Host ctx: `get(name)` answers like dsh's services. Pass `rows`, and override `connection`
 * or `workspaceRegistry` (null removes the service).
 */
function fakeCtx({ rows = [], connection, workspaceRegistry } = {}) {
  const archived = []
  const services = {
    connection: connection === undefined ? { requestRejection: () => undefined } : connection,
    sessionController: { list: async () => ({ items: rows }) },
    workspaceRegistry: workspaceRegistry === undefined ? { archiveSession: async (id) => { archived.push(id) } } : workspaceRegistry,
  }
  return { archived, get: (name) => services[name] ?? undefined }
}

function fixture(ids) {
  const root = mkdtempSync(join(tmpdir(), 'dai-sessions-'))
  for (const id of ids) {
    const dir = join(root, '--proj--', id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.v4.jsonl.zstd'), 'x')
  }
  return root
}

function call(handler, body, { method = 'POST' } = {}) {
  return new Promise((done) => {
    const req = (async function* () { yield Buffer.from(JSON.stringify(body)) })()
    req.method = method
    req.headers = { host: '127.0.0.1:1' }
    const res = { setHeader() {}, end(text) { done({ status: this.statusCode, body: JSON.parse(text) }) } }
    handler(req, res)
  })
}

const exists = (root, id) => existsSync(join(root, '--proj--', id))

async function withRoot(ids, run) {
  const root = fixture(ids)
  try { await run(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

test('deletes the subagent folder and its descendants, archives the target first, touches nothing else', () => withRoot([ID, CHILD, OTHER], async (root) => {
  const ctx = fakeCtx({ rows: [sub(ID, { parentSessionId: 'root0000' }), sub(CHILD, { parentSessionId: ID }), sub(OTHER)] })
  const out = await call(createDeleteHandler(ctx, { root }), { sessionId: ID })
  assert.equal(out.status, 200)
  assert.equal(out.body.deleted, 2)
  assert.deepEqual([exists(root, ID), exists(root, CHILD), exists(root, OTHER)], [false, false, true])
  assert.deepEqual(ctx.archived, [ID])
}))

test('refuses a running target or a running descendant, and archives nothing', () => withRoot([ID, CHILD], async (root) => {
  for (const rows of [[sub(ID, { running: true })], [sub(ID), sub(CHILD, { parentSessionId: ID, running: true })]]) {
    const ctx = fakeCtx({ rows })
    assert.equal((await call(createDeleteHandler(ctx, { root }), { sessionId: ID })).status, 409)
    assert.deepEqual(ctx.archived, [])
  }
  assert.equal(exists(root, ID), true)
}))

test('refuses a session or a descendant that is not a subagent', () => withRoot([ID, CHILD], async (root) => {
  for (const rows of [[{ sessionId: ID, running: false }], [sub(ID), { sessionId: CHILD, parentSessionId: ID }]]) {
    const ctx = fakeCtx({ rows })
    assert.equal((await call(createDeleteHandler(ctx, { root }), { sessionId: ID })).status, 403)
    assert.deepEqual(ctx.archived, [])
  }
  assert.equal(exists(root, ID), true)
}))

test('an id the controller does not list is never deleted, even with its folder on disk', () => withRoot([ID], async (root) => {
  const ctx = fakeCtx({ rows: [sub(OTHER)] })
  const handler = createDeleteHandler(ctx, { root })
  assert.equal((await call(handler, { sessionId: ID })).status, 404)
  assert.equal((await call(handler, { sessionId: ID.toUpperCase() })).status, 400)
  assert.equal(exists(root, ID), true)
  assert.deepEqual(ctx.archived, [])
}))

test("a missing folder answers 410; a descendant alone is never deleted in the target's place", () => withRoot([CHILD], async (root) => {
  const ctx = fakeCtx({ rows: [sub(ID), sub(CHILD, { parentSessionId: ID })] })
  assert.equal((await call(createDeleteHandler(ctx, { root }), { sessionId: ID })).status, 410)
  assert.equal(exists(root, CHILD), true)
  assert.deepEqual(ctx.archived, [])
}))

test('when the archive is refused or the registry is missing, nothing is removed', () => withRoot([ID], async (root) => {
  const rows = [sub(ID)]
  const refuse = fakeCtx({ rows, workspaceRegistry: { archiveSession: async () => { throw new Error('active work') } } })
  assert.equal((await call(createDeleteHandler(refuse, { root }), { sessionId: ID })).status, 409)
  const missing = fakeCtx({ rows, workspaceRegistry: null })
  assert.equal((await call(createDeleteHandler(missing, { root }), { sessionId: ID })).status, 503)
  assert.equal(exists(root, ID), true)
}))

test('rejects path-like ids and non-POST', () => withRoot([ID], async (root) => {
  const h = createDeleteHandler(fakeCtx({ rows: [sub(ID)] }), { root })
  assert.equal((await call(h, { sessionId: '../../etc/passwd' })).status, 400)
  assert.equal((await call(h, { sessionId: 'a..bbbbbbbbbb' })).status, 400)
  assert.equal((await call(h, { sessionId: ID }, { method: 'GET' })).status, 405)
  assert.equal(exists(root, ID), true)
}))

test('the Connection gate decides: a rejection, a missing service or one without requestRejection blocks both routes', () => withRoot([ID], async (root) => {
  const rows = [sub(ID)]
  for (const [connection, status] of [[{ requestRejection: () => 403 }, 403], [{ requestRejection: () => 401 }, 401], [null, 503], [{}, 503]]) {
    const ctx = fakeCtx({ rows, connection })
    assert.equal((await call(createDeleteHandler(ctx, { root }), { sessionId: ID })).status, status)
    assert.equal((await call(createExistsHandler(ctx, { root }), { ids: [ID] })).status, status)
    assert.deepEqual(ctx.archived, [])
  }
  assert.equal(exists(root, ID), true)
}))

test('a folder without a session log is never removed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dai-sessions-'))
  mkdirSync(join(root, '--proj--', ID), { recursive: true })
  writeFileSync(join(root, '--proj--', ID, 'notes.txt'), 'keep')
  try {
    const ctx = fakeCtx({ rows: [sub(ID)] })
    assert.equal((await call(createDeleteHandler(ctx, { root }), { sessionId: ID })).status, 410)
    assert.equal(existsSync(join(root, '--proj--', ID, 'notes.txt')), true)
    assert.deepEqual(ctx.archived, [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('exists reports only ids with no folder, never a live one, and nothing when the read is incomplete', () => withRoot([ID], async (root) => {
  const ctx = fakeCtx({ rows: [sub(CHILD, { running: true }), sub(OTHER, { agentAvailable: true })] })
  const out = await call(createExistsHandler(ctx, { root }), { ids: [ID, CHILD, OTHER, LIVE, 'not an id'] })
  assert.deepEqual(out.body.missing, [LIVE])
  assert.deepEqual((await call(createExistsHandler(ctx, { root: join(root, 'nope') }), { ids: [LIVE] })).body.missing, [])
  const down = fakeCtx()
  down.get = (name) => (name === 'connection' ? { requestRejection: () => undefined } : { list: async () => { throw new Error('down') } })
  assert.deepEqual((await call(createExistsHandler(down, { root }), { ids: [LIVE] })).body.missing, [])
  assert.equal((await call(createExistsHandler(ctx, { root }), { ids: Array(501).fill(ID) })).status, 400)
}))

test('a linked project folder makes the read incomplete, so nothing is reported missing', async (t) => {
  const root = fixture([ID])
  const target = mkdtempSync(join(tmpdir(), 'dai-target-'))
  try {
    try { symlinkSync(target, join(root, '--linked--'), 'junction') } catch { return t.skip('cannot create a link here') }
    const out = await call(createExistsHandler(fakeCtx(), { root }), { ids: [LIVE] })
    assert.deepEqual(out.body.missing, [])
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(target, { recursive: true, force: true }) }
})

test('sessionsRoot follows DSH_HOME, trimmed, else ~/.dsh', () => {
  assert.equal(sessionsRoot({ DSH_HOME: ' /x/home ' }, '/h'), resolve('/x/home', 'sessions'))
  assert.equal(sessionsRoot({}, '/h').endsWith(join('.dsh', 'sessions')), true)
  assert.equal(sessionsRoot({ DSH_HOME: '   ' }, '/h').endsWith(join('.dsh', 'sessions')), true)
})

test('collectTree orders parents before children and survives cycles', () => {
  const rows = [sub('a', { parentSessionId: 'b' }), sub('b', { parentSessionId: 'a' })]
  assert.equal(collectTree(rows, 'a').map((n) => n.id).join(), 'a,b')
})

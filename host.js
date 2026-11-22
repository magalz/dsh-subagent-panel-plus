/**
 * Host half: two routes for subagent sessions on disk.
 *
 *   POST /dsh-subagent-panel-plus/delete  { sessionId }  permanently deletes a subagent session
 *   POST /dsh-subagent-panel-plus/exists  { ids }        answers which of these have no folder any more
 *
 * dsh has no delete for sessions (only archive), so delete removes the session's folder under the
 * sessions root by hand (<root>/<project key>/<id>/, dsh-session-persistence-jsonl src/format.ts:267).
 * It refuses an id that matches no listed session (404), anything that is not a subagent (403),
 * anything running (409), and any folder without a session log. Only after those checks does it
 * archive the session through dsh's workspace registry (dsh then runs no model step for it or its
 * subagents) and remove the folders. Descendant subagents go with it. A missing folder answers 410.
 * `exists` lets the list hide sessions whose folder is gone, whoever removed it; it never reports a
 * session the controller lists as running or loaded, nor anything when the disk read was incomplete.
 *
 * Every request goes through dsh's own Connection gate (Host and Origin on this server's exact
 * authority, browser cookie), the one dsh applies to its other web routes; without that service
 * the routes refuse.
 *
 * The sessions root is <DSH_HOME or ~/.dsh>/sessions, the same path dsh-base mounts the persistence
 * backend on. The window between the running check and the archive is small but not zero.
 */
import { readdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const name = 'subagent-panel-plus'
export const inject = ['webServer']

const DELETE_ROUTE = '/dsh-subagent-panel-plus/delete'
const EXISTS_ROUTE = '/dsh-subagent-panel-plus/exists'

const SESSION_LIST_TIMEOUT_MS = 5_000
const EXISTS_LIMIT = 500
/** Session ids are lowercase uuids; this is the loosest shape that is still one safe path segment. */
const ID_SHAPE = /^[a-z0-9][a-z0-9._-]{7,127}$/u
/** The session log inside a session folder: session.v<N>.jsonl or .jsonl.zstd. */
const LOG_FILE = /^session\.v\d+\.jsonl(\.zstd)?$/u

export function apply(ctx) {
  ctx.effect(() => {
    const offs = [
      ctx.webServer.register({ kind: 'exact', path: DELETE_ROUTE, handler: createDeleteHandler(ctx) }),
      ctx.webServer.register({ kind: 'exact', path: EXISTS_ROUTE, handler: createExistsHandler(ctx) }),
    ]
    return () => { for (const off of offs) off() }
  }, 'subagent-panel-plus: routes')
}

/** The sessions root, as dsh-base derives it. */
export function sessionsRoot(env = process.env, home = homedir()) {
  const configured = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  return resolve(configured !== '' ? configured : join(home, '.dsh'), 'sessions')
}

function reply(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

/**
 * Wrap a POST route: dsh's Connection gate first (fails closed when the service is missing), then the
 * method, then the JSON body, and any throw becomes a 500. `fn(body)` answers with [status, body].
 */
function route(ctx, fn) {
  return async function handler(req, res) {
    const gate = ctx.get('connection')
    if (typeof gate?.requestRejection !== 'function') return reply(res, 503, { error: 'connection service is not mounted' })
    const rejection = gate.requestRejection(req)
    if (rejection !== undefined && rejection !== null && rejection !== false) {
      return reply(res, typeof rejection === 'number' ? rejection : 403, { error: 'request rejected' })
    }
    if (req.method !== 'POST') return reply(res, 405, { error: 'method not allowed' })
    try {
      const [status, body] = await fn(await readJson(req))
      reply(res, status, body)
    } catch (error) {
      reply(res, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 64 * 1024) throw new Error('request body too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

async function listRows(ctx) {
  const controller = ctx.get('sessionController')
  if (controller === undefined || controller === null) throw new Error('sessionController is not mounted')
  const result = await controller.list({}, AbortSignal.timeout(SESSION_LIST_TIMEOUT_MS))
  return Array.isArray(result?.items) ? result.items : []
}

/** The registry's archive, which also refuses a session with running work; undefined when not mounted. */
function archiveThrough(ctx) {
  const registry = ctx.get('workspaceRegistry')
  return typeof registry?.archiveSession === 'function' ? (id) => registry.archiveSession(id) : undefined
}

/** The target and every descendant subagent, parents before children. `row` is undefined when unlisted. */
export function collectTree(rows, id) {
  const byParent = new Map()
  for (const row of rows) {
    if (typeof row?.parentSessionId !== 'string') continue
    if (!byParent.has(row.parentSessionId)) byParent.set(row.parentSessionId, [])
    byParent.get(row.parentSessionId).push(row)
  }
  const out = []
  const seen = new Set()
  const visit = (sessionId, row) => {
    if (seen.has(sessionId)) return
    seen.add(sessionId)
    out.push({ id: sessionId, row })
    for (const child of byParent.get(sessionId) ?? []) visit(child.sessionId, child)
  }
  visit(id, rows.find((row) => row?.sessionId === id))
  return out
}

/**
 * Every session folder under the root: folder name (exact case) to its path. `complete` is false when
 * the root or any project folder could not be read, so a caller never mistakes a failed read for absence.
 */
async function folderIndex(root) {
  const index = new Map()
  let projects
  try { projects = await readdir(root, { withFileTypes: true }) } catch { return { index, complete: false } }
  let complete = true
  for (const project of projects) {
    // A link (junction or symlink) is never followed, and what lies behind it is unknown: not a complete read.
    if (project.isSymbolicLink()) complete = false
    if (!project.isDirectory()) continue
    let sessions
    try { sessions = await readdir(join(root, project.name), { withFileTypes: true }) } catch { complete = false; continue }
    for (const session of sessions) {
      if (session.isSymbolicLink()) complete = false
      if (session.isDirectory()) index.set(session.name, join(root, project.name, session.name))
    }
  }
  return { index, complete }
}

async function holdsLog(dir) {
  try { return (await readdir(dir)).some((file) => LOG_FILE.test(file)) } catch { return false }
}

/**
 * Build the delete handler. `deps.root` overrides the sessions root (tests).
 * @param {object} ctx
 * @param {{ root?: string }} [deps]
 */
export function createDeleteHandler(ctx, deps = {}) {
  const root = deps.root ?? sessionsRoot()
  return route(ctx, async (body) => {
    const id = typeof body?.sessionId === 'string' ? body.sessionId : ''
    if (!ID_SHAPE.test(id) || id.includes('..')) return [400, { error: 'invalid session id' }]
    const tree = collectTree(await listRows(ctx), id)
    // An id the controller does not list is never deleted: it may be a session the list leaves out.
    if (tree[0].row === undefined) return [404, { error: 'no such session: ' + id }]
    for (const { id: sessionId, row } of tree) {
      if (row.origin !== 'subagent') return [403, { error: 'not a subagent session: ' + sessionId }]
      if (row.running === true) return [409, { error: 'session is running: ' + sessionId }]
    }
    const { index: folders } = await folderIndex(root)
    // The target itself must be a session folder: a descendant alone is never deleted in its place.
    if (folders.get(id) === undefined || !(await holdsLog(folders.get(id)))) return [410, { error: 'session folder not found: ' + id }]
    const targets = []
    for (const { id: sessionId } of [...tree].reverse()) {
      const dir = folders.get(sessionId)
      if (dir !== undefined && await holdsLog(dir)) targets.push(dir)
    }
    // Archive only now that every check passed: dsh runs no model step for an archived session or its subagents.
    const archive = archiveThrough(ctx)
    if (archive === undefined) return [503, { error: 'workspace registry is not mounted' }]
    try { await archive(id) } catch (error) {
      return [409, { error: 'could not archive before deleting: ' + (error instanceof Error ? error.message : String(error)) }]
    }
    for (const dir of targets) await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    return [200, { deleted: targets.length }]
  })
}

/**
 * Build the exists handler: which of the posted ids have no session folder.
 * @param {object} ctx
 * @param {{ root?: string }} [deps]
 */
export function createExistsHandler(ctx, deps = {}) {
  const root = deps.root ?? sessionsRoot()
  return route(ctx, async (body) => {
    const ids = Array.isArray(body?.ids) ? body.ids.filter((id) => typeof id === 'string' && ID_SHAPE.test(id)) : []
    if (ids.length > EXISTS_LIMIT) return [400, { error: 'too many ids' }]
    const { index: folders, complete } = await folderIndex(root)
    // A failed or empty disk read answers nothing rather than "everything is gone".
    if (!complete || folders.size === 0) return [200, { missing: [] }]
    // A session the controller lists as running or loaded may not have written its folder yet.
    let live
    try {
      live = new Set((await listRows(ctx)).filter((row) => row?.running === true || row?.agentAvailable === true).map((row) => row.sessionId))
    } catch { return [200, { missing: [] }] }
    return [200, { missing: ids.filter((id) => !folders.has(id) && !live.has(id)) }]
  })
}

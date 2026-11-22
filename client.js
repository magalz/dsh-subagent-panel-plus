/* dsh-subagent-panel-plus: browser half, hand-written factory script (no build step).
   Replaces the session header's native subagent list (the "N subagents" chip and its tree) with a
   copy that shows each subagent's model as a third line, lists running subagents first, colours the
   status dot and adds a per-row menu (Archive, Delete). It registers under the native entry id at a
   lower priority (-1): dsh renders the lowest priority per id and throws on a same-priority duplicate.
   The native entry stays registered but is shadowed; removing the plugin restores the native chip.
   Not reproduced: the agent-team task board in the native footer (only an entry that declares that
   child slot can render it, and the native entry already does).
   Navigation calls are the ones dsh-client-ui-subagent makes (src/client/index.ts): uiWorkspace.openSession,
   sidebarRight.openResource, sessions.refreshProjections. The model comes from the summary's
   modelSelection projection (dsh-agent src/types.ts:89-100). */
window.__ModuleLoader__.load({
  id: 'dsh-subagent-panel-plus',
  factory(require) {
    'use strict'
    const React = require('react')
    const { createPortal } = require('react-dom')
    const h = React.createElement
    const { useMemo, useState, useEffect, useRef, useSyncExternalStore } = React

    const SLOT = 'conversation.session.header.actions'
    const NATIVE_ID = 'subagent-catalog'
    const LOCALE_NS = 'subagent'
    const CHAT_ADDRESS = 'dsh-resource://subagentchat/session/'
    const DELETE_ROUTE = '/dsh-subagent-panel-plus/delete'
    const EXISTS_ROUTE = '/dsh-subagent-panel-plus/exists'
    const NO_IDS = []

    /* ------------------------------ pure helpers ------------------------------ */

    /** The selection a subagent is using: the latest request's, else the one queued next. */
    function selectionOf(summary) {
      const projection = summary && summary.projectionValues && summary.projectionValues.modelSelection
      if (!projection) return null
      return projection.lastUsed || projection.next || null
    }

    /** "model · effort", or null while the session has recorded no selection yet. */
    function labelOf(selection) {
      if (!selection || !selection.model) return null
      return selection.reasoningEffort ? selection.model + ' · ' + selection.reasoningEffort : selection.model
    }

    /**
     * The row title the native tree shows: catalog label, else the session title, else the agent name.
     * (summary.displayTitle is not used: without a title it falls back to the workspace folder name.)
     */
    function titleOf(entry, summary) {
      return entry.label || (summary && summary.title) || entry.name || entry.id
    }

    /** running (green), done (blue), idle (yellow: not running, last turn not completed) or external. */
    function stateOf(summary, status, external) {
      if (external) return 'external'
      const running = (status && status.running !== undefined ? status.running : summary && summary.running) === true
      if (running) return 'running'
      const timing = summary && summary.projectionValues && summary.projectionValues.subagentTiming
      return timing && timing.lastTurnCompleted === true ? 'done' : 'idle'
    }

    const ORDER = { running: 0, idle: 1, done: 2, external: 3 }

    function totalTokens(usage) {
      return usage ? usage.uncachedInputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens : undefined
    }

    /** Whole active-turn time of one row, as the native tree computes it. */
    function durationOf(summary, state, now) {
      const timing = summary && summary.projectionValues && summary.projectionValues.subagentTiming
      if (!timing) return undefined
      if (timing.active === undefined) return timing.settledMs
      const end = state === 'running' ? now : timing.active.through
      return timing.settledMs + Math.max(0, end - timing.active.since)
    }

    /**
     * When the session started. dsh keeps no end-of-turn time on the summary: its timing projection drops
     * the interval at turn end, and `updatedAt` is max(createdAt, last user prompt), so for a subagent it is
     * the time of its spawn prompt.
     */
    function sinceOf(summary, state) {
      if (state === 'external' || !summary) return undefined
      return typeof summary.updatedAt === 'number' && summary.updatedAt > 0 ? summary.updatedAt : undefined
    }

    /** Local HH:MM, 24 hour. */
    function formatClock(ms) {
      const d = new Date(ms)
      const two = (n) => String(n).padStart(2, '0')
      return two(d.getHours()) + ':' + two(d.getMinutes())
    }

    function formatDuration(ms) {
      const total = Math.floor(Math.max(0, ms) / 1000)
      const s = total % 60
      const m = Math.floor(total / 60) % 60
      const hh = Math.floor(total / 3600)
      if (hh > 0) return hh + 'h ' + m + 'm'
      return m > 0 ? m + 'm ' + s + 's' : s + 's'
    }

    function formatTokens(value) {
      if (value < 1000) return String(value)
      const scaled = (n) => (n >= 100 ? String(Math.round(n)) : String(Math.round(n * 10) / 10))
      return value < 1e6 ? scaled(value / 1e3) + 'K' : scaled(value / 1e6) + 'M'
    }

    /** session id -> its subagentCatalog entries, from the session list's projections. */
    function catalogsOf(projections) {
      const out = {}
      for (const id of Object.keys(projections)) {
        const list = projections[id] && projections[id].values && projections[id].values.subagentCatalog
        if (list) out[id] = list
      }
      return out
    }

    /** Every catalog entry below `rootId`, depth first, each id once. */
    function walkCatalog(catalogs, rootId) {
      const seen = new Set()
      const out = []
      const visit = (parent) => {
        for (const entry of catalogs[parent] || []) {
          if (seen.has(entry.id)) continue
          seen.add(entry.id)
          out.push(entry)
          visit(entry.id)
        }
      }
      visit(rootId)
      return out
    }

    /**
     * The rows of one catalog level: running first, then idle, done and external; catalog order inside
     * each group (stable sort). `catalogs` maps a session id to its own catalog entries; `hidden` is a Set of ids.
     */
    function rowsOf(entries, byId, statuses, catalogs, hidden) {
      const rows = (entries || []).filter((entry) => !hidden.has(entry.id)).map((entry, index) => {
        const summary = byId[entry.id]
        const external = entry.mode === 'external'
        const selection = selectionOf(summary)
        return {
          index,
          entry,
          summary,
          external,
          title: titleOf(entry, summary),
          name: entry.mode === 'continuable' || external ? entry.name || entry.id : entry.id,
          model: labelOf(selection),
          provider: selection ? selection.provider : undefined,
          state: stateOf(summary, statuses.get(entry.id), external),
          canExpand: !external && (catalogs[entry.id] || NO_IDS).some((child) => !hidden.has(child.id)),
        }
      })
      return rows.sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.index - b.index)
    }

    const MODE_TEXT = { external: 'external', oneShot: 'one-shot', unknown: 'unknown mode', continuable: 'continuable' }

    /** What one row prints besides its title and model line. `tr(key, fallback)` translates. */
    function describeRow(row, parentId, now, tr) {
      const usage = row.summary && row.summary.projectionValues && row.summary.projectionValues.tokenUsage
      const modeKey = row.external ? 'external' : row.entry.mode === 'one-shot' ? 'oneShot' : row.entry.mode === 'unknown' ? 'unknown' : 'continuable'
      return {
        tokens: totalTokens(usage),
        ms: durationOf(row.summary, row.state, now),
        since: sinceOf(row.summary, row.state),
        address: { parentSessionId: parentId, childSessionId: row.entry.id, mode: row.entry.mode },
        secondary: [row.title !== row.name ? row.name : undefined, tr('mode.' + modeKey, MODE_TEXT[modeKey])].filter(Boolean).join(' · '),
      }
    }

    /* ------------------------------ hidden ids store ------------------------------ */

    /**
     * Ids kept out of the list: sessions dsh archived, and sessions whose folder is gone (the Host says
     * which; a parent's catalog names a deleted child for good). `workspaces()` returns dsh's workspace service.
     */
    function createHiddenStore(workspaces) {
      let gone = new Set()
      let cache = null
      const listeners = new Set()
      const archivedNow = () => {
        const service = workspaces()
        const snapshot = service && service.list && service.list.getSnapshot()
        return (snapshot && snapshot.archivedSessionIds) || NO_IDS
      }
      const notify = () => listeners.forEach((listener) => listener())
      return {
        getSnapshot() {
          const archived = archivedNow()
          if (!cache || cache.gone !== gone || cache.archived !== archived) cache = { gone, archived, set: new Set([...gone, ...archived]) }
          return cache.set
        },
        subscribe(listener) {
          listeners.add(listener)
          const service = workspaces()
          const off = service && service.list && typeof service.list.subscribe === 'function' ? service.list.subscribe(listener) : undefined
          return () => { listeners.delete(listener); if (typeof off === 'function') off() }
        },
        /** `missing` replaces what was known about the `checked` ids; ids outside `checked` stay as they were. */
        update(missing, checked) {
          const next = new Set(gone)
          for (const id of checked) next.delete(id)
          for (const id of missing) next.add(id)
          if (next.size === gone.size && [...next].every((id) => gone.has(id))) return
          gone = next
          notify()
        },
      }
    }

    /* --------------------------------- actions --------------------------------- */

    async function post(route, payload) {
      const response = await fetch(new URL(route.replace(/^\/+/u, ''), document.baseURI).pathname, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      let body = {}
      try { body = JSON.parse(await response.text()) } catch (e) { /* not json */ }
      return { status: response.status, ok: response.ok, body }
    }

    /** Read the catalog of `parentId` and of each direct child that can be read. */
    async function prepareCatalog(sessions, parentId) {
      await sessions.refreshProjections(parentId)
      const parent = sessions.list.getSnapshot().projectionsBySession[parentId]
      if (!parent || parent.state !== 'ready') return
      for (const entry of parent.values.subagentCatalog || []) {
        if (entry.mode === 'external') continue
        const state = sessions.list.getSnapshot()
        const child = state.projectionsBySession[entry.id]
        const stale = (state.byId[entry.id] && state.byId[entry.id].formatStatus === 'migration-required')
          || (child && (child.state === 'migration-required' || child.state === 'error'))
        if (!stale) await sessions.refreshProjections(entry.id)
      }
    }

    function createActions(ctx) {
      const hiddenStore = createHiddenStore(() => ctx.get('workspaces'))
      // Bumped by every check and by every delete: an older check's answer must not undo a newer fact.
      let epoch = 0
      return {
        hiddenStore,
        // A failed check changes nothing: the list shows everything, as it did before the plugin.
        async checkGone(ids) {
          const mine = ++epoch
          try {
            const out = await post(EXISTS_ROUTE, { ids })
            if (mine === epoch && out.ok && Array.isArray(out.body.missing)) hiddenStore.update(out.body.missing, ids)
          } catch (e) { /* keep the list as it is */ }
        },
        // Archive without stopping: dsh refuses while the session runs, and an archived session runs no model step.
        archive(id) { return ctx.uiWorkspace.archiveSession(id) },
        // The Host checks, archives and deletes, in that order; any refusal comes back here and the row stays.
        // 410: the folder is already gone. 404 would mean the Host does not list the session, so nothing is hidden.
        async remove(parentId, id) {
          const out = await post(DELETE_ROUTE, { sessionId: id })
          // After the answer, not before: a check that overlapped the delete must not count as newer than it.
          epoch += 1
          if (!out.ok && out.status !== 410) throw new Error(out.body.error || 'HTTP ' + out.status)
          hiddenStore.update([id], [])
          Promise.resolve(ctx.sessions.refreshProjections(parentId)).catch(() => {})
        },
        openChild(address) { ctx.uiWorkspace.openSession(address) },
        openChildAside(address) {
          const query = new URLSearchParams({ parent: address.parentSessionId, mode: address.mode })
          ctx.sidebarRight.openResource(CHAT_ADDRESS + encodeURIComponent(address.childSessionId) + '?' + query, { kind: 'subagentchat', preferNewPane: true })
        },
        prepareCatalog(parentId) { return prepareCatalog(ctx.sessions, parentId) },
      }
    }

    /* --------------------------------- styles --------------------------------- */

    const HOVER = 'var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))'
    const DIM = 'var(--dsw-alias-label-tertiary,#888)'
    const SURFACE = 'border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2));background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,#202124));box-shadow:var(--dsw-elevation-prominent,0 8px 28px rgba(0,0,0,.35));color:var(--dsw-alias-label-primary,inherit)'
    const ICON_BUTTON = 'display:inline-flex;align-items:center;justify-content:center;flex:none;align-self:center;width:28px;height:28px;margin:-6px 0;padding:6px;box-sizing:border-box;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:' + DIM + ';cursor:pointer'

    const CSS = [
      '.dai-root{position:relative;display:inline-flex;align-items:center;min-width:0}',
      '.dai-trigger{display:inline-flex;align-items:center;gap:6px;min-height:28px;padding:3px 2px;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:' + DIM + ';font:inherit;font-size:12px;line-height:18px;cursor:pointer}',
      '.dai-trigger:hover,.dai-trigger:focus-visible{color:var(--dsw-alias-label-primary,inherit)}',
      '.dai-live{width:7px;height:7px;border-radius:50%;background:#22c55e}',
      '.dai-menu{position:fixed;z-index:100;box-sizing:border-box;display:flex;flex-direction:column;max-height:min(560px,calc(100dvh - 140px));padding:6px;border-radius:var(--dsw-radius-lg,10px);font-size:12px;overflow:hidden;outline:none;' + SURFACE + '}',
      '.dai-body{display:flex;flex-direction:column;min-height:0;overflow:auto}',
      '.dai-node{position:relative;min-width:0}',
      '.dai-row{position:relative;display:flex;align-items:flex-start;gap:7px;box-sizing:border-box;width:100%;min-height:40px;padding:6px 6px 6px 9px;border-radius:var(--dsw-radius-md,8px);outline:none;cursor:pointer;font-size:12px;line-height:17px}',
      '.dai-row[aria-disabled=true]{cursor:default}',
      '.dai-row:hover,.dai-row:focus-visible{background:' + HOVER + '}',
      '.dai-disc,.dai-discspace{flex:none;width:14px;height:17px}',
      '.dai-disc{display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;background:transparent;color:' + DIM + ';cursor:pointer}',
      '.dai-disc svg{width:12px;height:12px;transition:transform 120ms ease}',
      '.dai-disc.open svg{transform:rotate(90deg)}',
      '.dai-dotslot{display:inline-flex;flex:none;align-items:center;justify-content:center;width:14px;height:17px}',
      '.dai-dot{width:8px;height:8px;border-radius:50%}',
      '.dai-content{display:flex;flex:1;flex-direction:column;min-width:0}',
      '.dai-title{font-size:13px;line-height:17px;overflow-wrap:anywhere}',
      '.dai-sub,.dai-model{font-size:12px;line-height:17px;color:' + DIM + ';overflow-wrap:anywhere}',
      '.dai-model{color:var(--dsw-alias-label-secondary,' + DIM + ')}',
      '.dai-metrics{display:grid;grid-template-rows:17px 17px 17px;flex:none;color:' + DIM + ';font-size:11px;line-height:17px;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}',
      '.dai-open,.dai-more{' + ICON_BUTTON + '}',
      '.dai-spacer{flex:none;width:63px}',
      '.dai-open:hover,.dai-open:focus-visible,.dai-more:hover,.dai-more:focus-visible,.dai-more[aria-expanded=true]{background:' + HOVER + ';color:var(--dsw-alias-label-primary,inherit)}',
      '.dai-open svg,.dai-more svg,.dai-item svg{width:14px;height:14px;flex:none}',
      '.dai-children{margin-left:16px;padding-left:3px;border-left:.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.3))}',
      '.dai-pop{position:fixed;z-index:110;box-sizing:border-box;width:220px;padding:4px;border-radius:var(--dsw-radius-md,8px);' + SURFACE + '}',
      '.dai-item{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:6px 8px;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:inherit;font:inherit;font-size:12px;line-height:17px;text-align:left;cursor:pointer}',
      '.dai-item:hover:not(:disabled),.dai-item:focus-visible{background:' + HOVER + '}',
      '.dai-item:disabled{opacity:.4;cursor:not-allowed}',
      '.dai-item.danger{color:var(--dsw-alias-state-error-primary,#e5484d)}',
      '.dai-note{padding:4px 8px 6px;color:' + DIM + ';font-size:11px;line-height:15px;overflow-wrap:anywhere}',
      '.dai-note.error{color:var(--dsw-alias-state-error-primary,#e5484d)}',
    ].join('\n')

    const DOT = { running: '#22c55e', idle: '#eab308', done: '#3b82f6', external: '#9ca3af' }

    const icon = (d, width = 1.5) => () => h('svg', { viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': true },
      h('path', { d, stroke: 'currentColor', strokeWidth: width, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    const Chevron = icon('M7.5 4.5L13 10l-5.5 5.5', 1.8)
    const ToSide = icon('M4 4h12v12H4zM12 4v12', 1.6)
    const Archive = icon('M3 5.5h14v3H3zM4.5 8.5V15h11V8.5M8 11.5h4')
    const Trash = icon('M4 6h12M8 6V4h4v2M5.5 6l.7 10h7.6l.7-10M8.5 9v4M11.5 9v4')
    const More = () => h('svg', { viewBox: '0 0 20 20', fill: 'currentColor', 'aria-hidden': true },
      h('circle', { cx: 4.5, cy: 10, r: 1.5 }), h('circle', { cx: 10, cy: 10, r: 1.5 }), h('circle', { cx: 15.5, cy: 10, r: 1.5 }))

    /* ------------------------------- components ------------------------------- */

    /**
     * While `open`: dismiss on a pointer-down outside every ref, and on Escape. `onDismiss(byEscape)` closes.
     * Optional `onResize`, `onScroll(event)`; `capture` also stops Escape from reaching other listeners.
     */
    function useDismiss(open, refs, { onDismiss, onResize, onScroll, capture }) {
      useEffect(() => {
        if (!open) return undefined
        const outside = (e) => { if (!refs.some((ref) => ref.current && ref.current.contains(e.target))) onDismiss(false) }
        const key = (e) => {
          if (e.key !== 'Escape') return
          e.preventDefault()
          if (capture) e.stopPropagation()
          onDismiss(true)
        }
        document.addEventListener('pointerdown', outside)
        document.addEventListener('keydown', key, !!capture)
        if (onResize) window.addEventListener('resize', onResize)
        if (onScroll) window.addEventListener('scroll', onScroll, true)
        return () => {
          document.removeEventListener('pointerdown', outside)
          document.removeEventListener('keydown', key, !!capture)
          if (onResize) window.removeEventListener('resize', onResize)
          if (onScroll) window.removeEventListener('scroll', onScroll, true)
        }
      }, [open])
    }

    /**
     * Where the row menu opens: outside the subagent list, beside it (right first, then left), level
     * with the button; inside the list under the button when neither side has room.
     */
    function placePop(button, width) {
      const r = button.getBoundingClientRect()
      const panel = button.closest('.dai-menu')
      const p = panel ? panel.getBoundingClientRect() : null
      const gap = 6
      const maxTop = Math.max(8, window.innerHeight - 160)
      if (p && window.innerWidth - p.right - 8 >= width + gap) return { top: Math.min(Math.max(8, r.top - 4), maxTop), left: p.right + gap }
      if (p && p.left - 8 >= width + gap) return { top: Math.min(Math.max(8, r.top - 4), maxTop), left: p.left - gap - width }
      return { top: Math.min(r.bottom + 4, maxTop), left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)) }
    }

    const stop = (e) => { e.stopPropagation() }
    // Keys on a row's own buttons must not reach the row (Enter would open it), but Escape still has to close the list.
    const stopKeys = (e) => { if (e.key !== 'Escape') e.stopPropagation() }

    /**
     * One "more" button per row; it opens a small menu with Archive and Delete. Delete takes two
     * clicks (the first arms it for 4 seconds). Both are disabled while the subagent runs, and a
     * refusal from the Host is shown in the menu, which stays open.
     */
    function RowActions({ parentId, id, running, actions }) {
      const [open, setOpen] = useState(false)
      const [armed, setArmed] = useState(false)
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(false)
      const [pos, setPos] = useState(null)
      const buttonRef = useRef(null)
      const popRef = useRef(null)
      const close = () => { setOpen(false); setArmed(false) }
      useEffect(() => {
        if (!armed) return undefined
        const timer = setTimeout(() => setArmed(false), 4000)
        return () => clearTimeout(timer)
      }, [armed])
      // Only the list itself scrolling closes the menu; the conversation behind it may scroll on its own.
      const onScroll = (e) => { if (e.target && e.target.contains && e.target.contains(buttonRef.current)) close() }
      useDismiss(open, [buttonRef, popRef], { onDismiss: close, onResize: close, onScroll, capture: true })
      const run = (task) => {
        setBusy(true)
        setError(null)
        Promise.resolve().then(task).then(close).catch((e) => setError(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false))
      }
      const toggle = (e) => {
        stop(e)
        if (open) { close(); return }
        setPos(placePop(buttonRef.current, 220))
        setError(null)
        setOpen(true)
      }
      const blocked = busy || running
      return [
        h('button', {
          key: 'more', ref: buttonRef, type: 'button', className: 'dai-more', 'aria-haspopup': 'menu', 'aria-expanded': open, title: 'More actions',
          onClick: toggle, onKeyDown: stopKeys,
        }, h(More)),
        open && pos ? h('div', { key: 'pop', ref: popRef, className: 'dai-pop', role: 'menu', style: { top: pos.top, left: pos.left }, onClick: stop, onKeyDown: stop },
          h('button', { type: 'button', role: 'menuitem', className: 'dai-item', disabled: blocked, onClick: () => run(() => actions.archive(id)) }, h(Archive), 'Archive'),
          h('button', {
            type: 'button', role: 'menuitem', disabled: blocked, className: 'dai-item danger',
            onClick: () => {
              if (!armed) { setError(null); setArmed(true); return }
              setArmed(false)
              run(() => actions.remove(parentId, id))
            },
          }, h(Trash), armed ? 'Click again to confirm' : 'Delete permanently'),
          running ? h('div', { className: 'dai-note' }, 'Stop this subagent before archiving or deleting it.') : null,
          armed ? h('div', { className: 'dai-note' }, 'This removes its session folder from disk. It cannot be undone.') : null,
          error ? h('div', { className: 'dai-note error' }, error) : null) : null,
      ]
    }

    function RowMetrics({ info }) {
      return h('span', { className: 'dai-metrics' },
        h('span', null, info.tokens !== undefined ? formatTokens(info.tokens) + ' tok' : ''),
        h('span', null, info.ms !== undefined ? formatDuration(info.ms) : ''),
        h('span', { title: info.since !== undefined ? 'Started ' + new Date(info.since).toLocaleString() : undefined }, info.since !== undefined ? 'since ' + formatClock(info.since) : ''))
    }

    /** One catalog level; expanded rows recurse. */
    function Level(p) {
      const { parentId, byId, statuses, catalogs, expanded, toggle, now, tr, actions, level, close, hidden } = p
      return rowsOf(catalogs[parentId], byId, statuses, catalogs, hidden).map((row) => {
        const id = row.entry.id
        const open = row.canExpand && expanded.has(id)
        const info = describeRow(row, parentId, now, tr)
        const onOpen = () => { if (!row.external) { actions.openChild(info.address); close() } }
        const onKeyDown = (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onOpen() }
          else if ((e.key === 'ArrowRight' && row.canExpand && !open) || (e.key === 'ArrowLeft' && open)) { e.preventDefault(); e.stopPropagation(); toggle(id) }
        }
        return h('div', { key: id, className: 'dai-node' },
          h('div', {
            role: 'treeitem', tabIndex: row.external ? -1 : 0, 'aria-level': level, 'aria-disabled': row.external || undefined,
            'aria-expanded': row.canExpand ? open : undefined, className: 'dai-row', onClick: onOpen, onKeyDown,
          },
          row.canExpand
            ? h('button', { type: 'button', tabIndex: -1, className: 'dai-disc' + (open ? ' open' : ''), onClick: (e) => { stop(e); toggle(id) } }, h(Chevron))
            : h('span', { className: 'dai-discspace' }),
          h('span', { className: 'dai-dotslot' }, h('span', { className: 'dai-dot', style: { background: DOT[row.state] }, role: 'img', 'aria-label': row.state })),
          h('span', { className: 'dai-content' },
            h('span', { className: 'dai-title' }, row.title),
            info.secondary ? h('span', { className: 'dai-sub' }, info.secondary) : null,
            h('span', { className: 'dai-model', title: row.provider ? row.provider + '/' + (row.model || '') : undefined }, row.model || '—')),
          h(RowMetrics, { info }),
          row.external ? h('span', { className: 'dai-spacer' }) : [
            h('button', {
              key: 'side', type: 'button', className: 'dai-open', title: tr('open.sidebar', 'Open in sidebar'),
              onClick: (e) => { stop(e); actions.openChildAside(info.address); close() }, onKeyDown: stopKeys,
            }, h(ToSide)),
            h(RowActions, { key: 'more', parentId, id, running: row.state === 'running', actions }),
          ]),
          open ? h('div', { role: 'group', className: 'dai-children' }, h(Level, Object.assign({}, p, { parentId: id, level: level + 1 }))) : null)
      })
    }

    /** Index to focus for a key among `count` tree rows when `at` is focused (-1: none), or -1 for another key. */
    function focusTarget(count, at, key) {
      if (count === 0) return -1
      const wrap = (i) => (i + count) % count
      if (key === 'Home') return 0
      if (key === 'End') return count - 1
      if (key === 'ArrowDown') return wrap(at + 1)
      if (key === 'ArrowUp') return wrap(at < 0 ? count - 1 : at - 1)
      return -1
    }

    function treeItems(root) {
      return root ? Array.from(root.querySelectorAll('[role="treeitem"]:not([aria-disabled="true"])')) : []
    }

    function Dropdown(p) {
      const { rootId, useSessions, useSessionStatus, actions, t } = p
      const projections = useSessions((state) => state.projectionsBySession)
      const byId = useSessions((state) => state.byId)
      const statuses = useSessionStatus((value) => value)
      const hidden = useSyncExternalStore(actions.hiddenStore.subscribe, actions.hiddenStore.getSnapshot)
      const [open, setOpen] = useState(false)
      const [expanded, setExpanded] = useState(() => new Set())
      const [now, setNow] = useState(() => Date.now())
      const [pos, setPos] = useState(null)
      const pinned = useRef(false)
      const focusNext = useRef(null)
      const openTimer = useRef()
      const closeTimer = useRef()
      const triggerRef = useRef(null)
      const menuRef = useRef(null)

      const tr = (key, fallback, params) => {
        const text = t(key, params)
        return typeof text === 'string' && text !== key ? text : fallback
      }

      const catalogs = useMemo(() => catalogsOf(projections), [projections])
      const below = useMemo(() => walkCatalog(catalogs, rootId), [catalogs, rootId])
      const idsKey = useMemo(() => below.filter((e) => e.mode !== 'external').map((e) => e.id).sort().join(','), [below])
      const check = () => { if (idsKey !== '') actions.checkGone(idsKey.split(',')) }
      useEffect(check, [idsKey])

      const direct = rowsOf(catalogs[rootId], byId, statuses, catalogs, hidden)
      const running = direct.filter((r) => r.state === 'running').length
      // The clock ticks for any running row, however deep it is nested.
      const anyRunning = below.some((e) => !hidden.has(e.id) && stateOf(byId[e.id], statuses.get(e.id), e.mode === 'external') === 'running')
      useEffect(() => {
        if (!anyRunning) return undefined
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [anyRunning])

      const clearTimers = () => { clearTimeout(openTimer.current); clearTimeout(closeTimer.current) }
      const place = () => {
        const r = triggerRef.current && triggerRef.current.getBoundingClientRect()
        if (!r) return
        const width = Math.min(380, window.innerWidth - 32)
        setPos({ top: r.bottom + 5, left: Math.max(16, Math.min(r.left, window.innerWidth - width - 16)), width })
      }
      const changeOpen = (next, restoreFocus) => {
        clearTimers()
        if (next) { place(); setOpen(true); check() } else {
          pinned.current = false
          setOpen(false)
          setExpanded(new Set())
          if (restoreFocus && triggerRef.current) triggerRef.current.focus()
        }
      }
      const prepare = (id) => {
        Promise.resolve(actions.prepareCatalog(id)).catch((e) => console.error('[subagent-panel-plus] catalog discovery failed:', e))
      }
      const toggle = (id) => {
        if (!expanded.has(id)) { setExpanded((cur) => new Set(cur).add(id)); prepare(id); return }
        const closing = new Set([id, ...walkCatalog(catalogs, id).map((e) => e.id)])
        setExpanded((cur) => new Set([...cur].filter((x) => !closing.has(x))))
      }

      useDismiss(open, [triggerRef, menuRef], { onDismiss: (byEscape) => changeOpen(false, byEscape), onResize: place })
      useEffect(() => clearTimers, [])
      // After a click or ArrowDown opened the menu, move focus into it.
      useEffect(() => {
        if (!open || !pos || !menuRef.current || !focusNext.current) return
        const first = treeItems(menuRef.current)[0]
        if (focusNext.current === 'first' && first) first.focus()
        else menuRef.current.focus()
        focusNext.current = null
      }, [open, pos])
      const empty = direct.length === 0
      useEffect(() => { if (empty && open) changeOpen(false) }, [empty, open])

      if (empty) return null
      const count = direct.length
      const label = tr(count === 1 ? 'count.total.one' : 'count.total.other', count + (count === 1 ? ' subagent' : ' subagents'), { count })

      const scheduleClose = () => { clearTimers(); if (pinned.current) return; closeTimer.current = setTimeout(() => changeOpen(false), 120) }
      const openPinned = (focus) => {
        clearTimers()
        pinned.current = true
        focusNext.current = focus
        if (!open) changeOpen(true)
        else setPos((cur) => ({ ...cur }))
        prepare(rootId)
      }
      const navigate = (e) => {
        const inTree = e.target instanceof Element && (e.target === triggerRef.current || e.target === menuRef.current || e.target.closest('[role="tree"]'))
        if (!inTree) return
        const items = treeItems(menuRef.current)
        const next = focusTarget(items.length, items.indexOf(document.activeElement), e.key)
        if (next < 0) return
        items[next].focus()
        e.preventDefault()
      }
      return h('div', { className: 'dai-root', 'data-dsh-subagent-panel-plus': '', onPointerLeave: scheduleClose, onKeyDown: navigate },
        h('button', {
          ref: triggerRef, type: 'button', className: 'dai-trigger', 'aria-haspopup': 'dialog', 'aria-expanded': open, 'aria-label': label,
          onPointerEnter: (e) => {
            if (e.pointerType === 'touch') return
            clearTimers()
            if (!open) openTimer.current = setTimeout(() => changeOpen(true), 150)
          },
          onClick: () => {
            if (open && pinned.current) { clearTimers(); changeOpen(false, true); return }
            openPinned('menu')
          },
          onKeyDown: (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); openPinned('first') } },
        }, running > 0 ? h('span', { className: 'dai-live', 'aria-hidden': true }) : null, h('span', null, label)),
        open && pos ? createPortal(
          h('div', {
            ref: menuRef, tabIndex: -1, className: 'dai-menu', role: 'dialog', 'aria-label': label, style: { top: pos.top, left: pos.left, width: pos.width },
            onPointerEnter: () => clearTimeout(closeTimer.current), onPointerLeave: scheduleClose,
          },
          h('div', { className: 'dai-body' },
            h('div', { role: 'tree' },
              h(Level, { parentId: rootId, byId, statuses, catalogs, expanded, toggle, now, tr, actions, level: 1, close: () => changeOpen(false), hidden })))),
          document.body) : null)
    }

    /** The native entry renders nothing on a child session (its breadcrumb owns navigation). */
    function Action(p) {
      const addressedChild = p.useSession((snapshot) => snapshot.subagent !== null)
      const listedChild = p.useSessions((state) => !!state.byId[p.sessionId] && state.byId[p.sessionId].origin === 'subagent')
      if (addressedChild || listedChild) return null
      return h(Dropdown, { key: p.sessionId, rootId: p.sessionId, useSessions: p.useSessions, useSessionStatus: p.useSessionStatus, actions: p.actions, t: p.t })
    }

    /* --------------------------------- plugin --------------------------------- */

    return {
      inject: ['slots', 'sessions', 'uiWorkspace', 'sidebarRight'],
      helpers: { titleOf, stateOf, rowsOf, describeRow, walkCatalog, Level, focusTarget, durationOf, sinceOf, formatClock, formatDuration, formatTokens, selectionOf, labelOf, createHiddenStore },
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.textContent = CSS
          document.head.appendChild(style)
          return () => { style.remove() }
        }, 'dsh-subagent-panel-plus: styles')
        const actions = createActions(ctx)
        const component = (props) => h(Action, Object.assign({}, props, { actions }))
        // priority -1 shadows the native entry (same id): dsh renders the lowest priority.
        const spec = { name: SLOT, id: NATIVE_ID, order: 10, priority: -1, locale: LOCALE_NS }
        ctx.slots.inject(SLOT, () => ctx.slots.register(spec, component))
      },
    }
  },
})

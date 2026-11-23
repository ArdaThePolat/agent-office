// Agent Office companion mod.
//
// The office's hook knows what a session is doing (its state, its subagents as they start and
// stop). This mod adds what only the session itself can see, and writes it next to the hook's
// file, as <state>/live/<session-id>.json:
//
//   { id, updated, model, context: {tokens, window, percent}, costUsd,
//     rateLimits: [{kind, percentUsed, resetsAt, seenAt}], agents: [{id, type, status, description}] }
//
// A session's limits are the ones its last API reply carried, so an idle session keeps reporting
// an old number. seenAt (unix seconds) is when this session's reading of that limit last CHANGED,
// which is when it last came from the server: the office trusts the newest one, so a session that
// has seen a reset outvotes the idle ones still holding the number from before it.
//
// It also pins a one-line status under the prompt: how many of your OTHER sessions need you or
// are working, read from the office's session files. Nothing here records prompts or tool calls.
//
// Every step is best effort: a failure is swallowed, so the mod can never break the session.

const REPORT_EVERY_MS = 20_000
const DONE_FRESH_S = 30 * 60

let stateDir = null
let sessionId = null
let timer = null
let seen = null   // kind -> {percentUsed, resetsAt, seenAt}, as last written

async function dir($) {
  if (stateDir) return stateDir
  const own = await $.env.get('AGENT_OFFICE_STATE')
  const home = await $.env.get('HOME')
  stateDir = own || `${home}/.local/state/agent-office`
  return stateDir
}

// Carry each limit's seenAt over while its reading is unchanged. The first report of a process
// takes them from the file it is about to replace, so a resumed or restarted session does not
// pass off the number it had before as a new one.
async function stamp($, base, limits) {
  if (!seen) {
    seen = new Map()
    try {
      const old = JSON.parse(await $.fs.read(`${base}/live/${sessionId}.json`))
      for (const r of old.rateLimits || []) if (r.seenAt) seen.set(r.kind, r)
    } catch (_) { /* no earlier report */ }
  }
  const now = Math.floor(Date.now() / 1000)
  return limits.map(r => {
    const b = seen.get(r.kind), resetsAt = r.resetsAt ?? null
    const same = b && b.percentUsed === r.percentUsed && b.resetsAt === resetsAt
    const out = { kind: r.kind, percentUsed: r.percentUsed, resetsAt, seenAt: same ? b.seenAt : now }
    seen.set(r.kind, out)
    return out
  })
}

async function report($) {
  try {
    sessionId = sessionId || (await $.session.id())
    const base = await dir($)
    const [usage, agents, model] = await Promise.all([
      $.session.usage(),
      $.agent.list().catch(() => []),
      $.session.model().catch(() => ''),
    ])
    const live = {
      id: sessionId,
      updated: Math.floor(Date.now() / 1000),
      model,
      context: {
        tokens: usage.context?.tokens ?? null,
        window: usage.context?.window ?? null,
        percent: usage.context?.percent ?? null,
      },
      costUsd: usage.cost ? usage.cost.usd : null,
      rateLimits: await stamp($, base, usage.rateLimits || []),
      agents: (agents || []).map(a => ({
        id: a.id, type: a.type, status: a.status, description: a.description || '',
      })),
    }
    await $.fs.write(`${base}/live/${sessionId}.json`, JSON.stringify(live))
  } catch (_) { /* best effort */ }
}

// "office: 2 need you (Flaky test hunt, Infra cleanup) · 3 working", or nothing when there is
// nothing to say. This session is left out: you are already looking at it.
async function status($) {
  try {
    const base = await dir($)
    const now = Date.now() / 1000
    const entries = await $.fs.list(`${base}/sessions`).catch(() => [])
    const needs = [], working = []
    for (const e of entries) {
      if (!e.name.endsWith('.json') || e.name === `${sessionId}.json`) continue
      let s
      try { s = JSON.parse(await $.fs.read(`${base}/sessions/${e.name}`)) } catch (_) { continue }
      if (!s || s.kind === 'review' || now - (s.updated || 0) > 12 * 3600) continue
      if (s.state === 'waiting' || s.state === 'crashed') needs.push(s.title || 'untitled')
      else if (s.state === 'working' || s.state === 'compacting' || s.state === 'background') working.push(s)
      else if (s.state === 'done' && now - (s.since || 0) < DONE_FRESH_S) { /* done: not worth a line */ }
    }
    const parts = []
    if (needs.length) {
      const names = needs.slice(0, 2).join(', ') + (needs.length > 2 ? ', …' : '')
      parts.push(`${needs.length} need${needs.length === 1 ? 's' : ''} you (${names})`)
    }
    if (working.length) parts.push(`${working.length} working`)
    $.ui.status(parts.length ? `office: ${parts.join(' · ')}` : undefined)
  } catch (_) { /* best effort */ }
}

async function tick($) {
  await report($)
  await status($)
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await tick($)
    timer?.cancel()
    timer = $.clock.every(REPORT_EVERY_MS, () => { tick($) })
    return next(e)
  })

  // after each turn, and when a plan limit's percent changes
  on('session.measure', async ($, e, next) => {
    await report($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await tick($)
    return result
  })

  // a subagent is about to start: report once it has
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    $.clock.after(1000, () => { report($) })
    return result
  })

  on('session.end', async ($, e, next) => {
    timer?.cancel()
    timer = null
    return next(e)
  })
}

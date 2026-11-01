// Your Linear issues in a pane, as herdr-linear's popup has them: grouped by
// status, an issue's screen, its status changed, its branch copied, and Start,
// which makes it yours and In Progress and hands it to a Claude Code cloud
// session.
//
// It signs in to Linear itself, with OAuth as herdr-linear does (its public
// client: PKCE, no secret), and talks to Linear's API with its own requests.
// Linear sends the browser back to a localhost page that needn't load: its
// address is pasted into the pane, so signing in works over SSH too. The
// tokens are kept in the plugin's store, on this machine.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { DEMO, demoGql } from './demo'
import type { Detail, Issue, Loaded, Notice, Project, ProjectsLoaded, Scope, SignIn, Status, View, Workspace } from '../types'

const PANE = 'linear'

const view = atom({ plugin: 'linear', key: 'view' } as const, { screen: 'list' } as View, { shape: 'view-2' })
const workspace = atom({ plugin: 'linear', key: 'workspace' } as const, null as string | null)
const workspaces = atom({ plugin: 'linear', key: 'workspaces' } as const, [] as Workspace[], { shape: 'workspaces-1' })
const signin = atom({ plugin: 'linear', key: 'signin' } as const, null as SignIn | null, { shape: 'signin-1' })
const loaded = atom({ plugin: 'linear', key: 'loaded' } as const, {} as Record<string, Loaded>, { shape: 'loaded-2' })
const details = atom({ plugin: 'linear', key: 'details' } as const, {} as Record<string, Detail>, { shape: 'details-4' })
const statuses = atom({ plugin: 'linear', key: 'statuses' } as const, {} as Record<string, Status[]>, { shape: 'statuses-2' })
const filter = atom({ plugin: 'linear', key: 'filter' } as const, '')
const selected = atom({ plugin: 'linear', key: 'selected' } as const, 0)
// How many lines of the list the pane has room for, as it was last drawn.
let room = 20

// The element the pane's keyboard is on: the filter, as it opens.
let ring: string | null = null
const tab = atom({ plugin: 'linear', key: 'tab' } as const, 'issues' as 'issues' | 'projects')
const projects = atom({ plugin: 'linear', key: 'projects' } as const, {} as Record<string, ProjectsLoaded>, { shape: 'projects-1' })
const scope = atom({ plugin: 'linear', key: 'scope' } as const, null as Scope | null, { shape: 'scope-1' })

// The list's lines: a heading per status, its issues, a blank between
// statuses.
type Line =
  | { kind: 'head'; status: string; count: number; type: string }
  | { kind: 'issue'; issue: Issue }
  | { kind: 'project'; project: Project }
  | { kind: 'gap' }

function lines(groups: Map<string, Issue[]>): Line[] {
  const out: Line[] = []
  for (const [status, list] of groups) {
    if (out.length) out.push({ kind: 'gap' })
    out.push({ kind: 'head', status, count: list.length, type: list[0]!.statusType })
    for (const issue of list) out.push({ kind: 'issue', issue })
  }
  return out
}

// Projects as the list has them: by state, work in flight first.
const PROJECT_STATES = ['started', 'planned', 'paused', 'backlog']

function projectLines(all: Project[], f: string): Line[] {
  const out: Line[] = []
  const shown = all.filter(p => !f || `${p.name} ${p.lead ?? ''} ${p.state}`.toLowerCase().includes(f.toLowerCase()))
  for (const state of PROJECT_STATES) {
    const list = shown.filter(p => p.state === state)
    if (!list.length) continue
    if (out.length) out.push({ kind: 'gap' })
    out.push({ kind: 'head', status: state[0]!.toUpperCase() + state.slice(1), count: list.length, type: state === 'planned' ? 'unstarted' : state })
    for (const project of list) out.push({ kind: 'project', project })
  }
  return out
}

// The rows the highlight walks: issues or projects.
const rowsOf = (l: Line[]) => l.filter((x): x is Extract<Line, { kind: 'issue' | 'project' }> => x.kind === 'issue' || x.kind === 'project')
const rowKey = (l: Line) => (l.kind === 'issue' ? `issue-${l.issue.id}` : l.kind === 'project' ? `project-${l.project.id}` : '')

// What the list shows now: the tab's lines, for the filter.
async function currentLines($: EngineInterface): Promise<Line[]> {
  const key = await read($, workspace)
  if (!key) return []
  const f = await read($, filter)
  // A project open: its issues, like an issue's screen over the tabs.
  const sc = await read($, scope)
  if (sc) return lines(grouped((await read($, loaded))[`p:${sc.id}`]?.issues ?? [], f))
  if ((await read($, tab)) === 'projects') return projectLines((await read($, projects))[key]?.projects ?? [], f)
  return lines(grouped((await read($, loaded))[key]?.issues ?? [], f))
}

const cut = (text: string, n: number) => (text.length <= n ? text : n <= 1 ? '' : `${text.slice(0, n - 1)}…`)

// An issue's title and project, cut so its row is one line in `width`
// columns: a row that wraps makes the list taller than the pane, and the
// arrows then scroll it instead of moving between issues.
function fit(i: Issue, width: number, idWidth = i.id.length): { title: string; project: string | null } {
  const room = width - 2 - (2 + idWidth + 1) - (i.priority === 1 ? 7 : 0)
  if (!i.project) return { title: cut(i.title, room), project: null }
  const title = cut(i.title, Math.max(12, Math.min(i.title.length, room - 3 - Math.min(i.project.length, 16))))
  const left = room - title.length - 3
  return { title, project: left >= 4 ? cut(i.project, left) : null }
}


const notice = atom({ plugin: 'linear', key: 'notice' } as const, null as Notice | null, { shape: 'notice-1' })
const from = atom({ plugin: 'linear', key: 'from' } as const, null as string | null)

// Whether the GitHub mod is installed, for an issue's pull requests.
let hasGithub = false

// A PR's state from what Linear keeps of it: open, draft, merged, closed.
const PR_ORDER = ['open', 'draft', 'merged', 'closed']
export function prState(m: any): string {
  const s = String(m?.status ?? 'open').toLowerCase()
  if (s === 'merged' || m?.mergedAt) return 'merged'
  if (s === 'closed') return 'closed'
  return m?.draft || s === 'draft' ? 'draft' : 'open'
}
const PR_LOOK: Record<string, { mark: string; color: string }> = {
  open: { mark: '●', color: 'success' },
  draft: { mark: '◌', color: 'subtle' },
  merged: { mark: '⇄', color: 'merged' },
  closed: { mark: '✗', color: 'error' },
}

// owner/repo#n from a pull request's address on GitHub, or null.
export function pullKey(url: string): string | null {
  const m = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(url)
  return m ? `${m[1]}#${m[2]}` : null
}

// ── Linear's OAuth, as herdr-linear signs in ─────────────────────────────────

const CLIENT_ID = '446107c5f38f5735e179c8e06af26ca0'
const REDIRECT = 'http://localhost:47821/callback'
const AUTHORIZE = 'https://linear.app/oauth/authorize'
const TOKEN = 'https://api.linear.app/oauth/token'
const API = 'https://api.linear.app/graphql'

// A workspace's sign-in, as kept in the store under `account:<key>`.
type Account = { key: string; name: string; access: string; refresh: string | null; expiresAt: number }

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function random(n: number): string {
  return b64url(crypto.getRandomValues(new Uint8Array(n)))
}

const form = (o: Record<string, string>) =>
  Object.entries(o)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

async function beginSignIn($: EngineInterface) {
  const verifier = random(48)
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
  const state = random(16)
  const url =
    `${AUTHORIZE}?` +
    form({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      response_type: 'code',
      scope: 'read,write',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      // Linear's consent screen every time: it's where the workspace is chosen.
      prompt: 'consent',
    })
  await update($, signin, () => ({ state, verifier, url, error: null, isBusy: false }))
  await update($, view, (): View => ({ screen: 'signin' }))
}

async function tokenRequest($: EngineInterface, body: Record<string, string>) {
  const r = await $.http.fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form(body),
  })
  const t = JSON.parse(r.text || '{}')
  if (!r.ok || !t.access_token) throw new Error(t.error_description ?? t.error ?? `Linear answered ${r.status}`)
  return t as { access_token: string; refresh_token?: string; expires_in?: number }
}

// The address the browser landed on, pasted: its code, traded for tokens.
async function finishSignIn($: EngineInterface, pasted: string) {
  const s = await read($, signin)
  if (!s) return
  let code: string | null = null
  try {
    const u = new URL(pasted.trim())
    if (u.searchParams.get('state') !== s.state) throw new Error('state')
    code = u.searchParams.get('code')
  } catch {
    code = null
  }
  if (!code) {
    await update($, signin, x => x && { ...x, error: "That isn't the address Linear sent you to for this sign-in: paste the whole address of the page you landed on after approving." })
    return
  }
  await update($, signin, x => x && { ...x, isBusy: true, error: null })
  try {
    const t = await tokenRequest($, { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: CLIENT_ID, code_verifier: s.verifier })
    const account: Account = {
      key: '',
      name: '',
      access: t.access_token,
      refresh: t.refresh_token ?? null,
      expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : Number.MAX_SAFE_INTEGER,
    }
    const me = await gqlWith($, account, `query { viewer { organization { name urlKey } } }`)
    account.key = me.viewer.organization.urlKey
    account.name = me.viewer.organization.name
    await $.store.set(`account:${account.key}`, account)
    const list = await update($, workspaces, all => [...all.filter(w => w.key !== account.key), { key: account.key, name: account.name }])
    await $.store.set('workspaces', list)
    await update($, workspace, () => account.key)
    await update($, signin, () => null)
    await update($, view, (): View => ({ screen: 'list' }))
    await say($, `Signed in to ${account.name}.`)
    void load($, account.key)
  } catch (err) {
    await update($, signin, x => x && { ...x, isBusy: false, error: `Sign-in failed: ${message(err)}` })
  }
}

async function account($: EngineInterface, key: string): Promise<Account> {
  const a = (await $.store.get(`account:${key}`)) as Account | undefined
  if (!a) throw new Error(`Not signed in to ${key}.`)
  return a
}

async function refreshed($: EngineInterface, a: Account): Promise<Account> {
  if (!a.refresh) throw new Error(`The sign-in to ${a.name} has expired: sign in again.`)
  const t = await tokenRequest($, { grant_type: 'refresh_token', refresh_token: a.refresh, client_id: CLIENT_ID })
  const next: Account = {
    ...a,
    access: t.access_token,
    refresh: t.refresh_token ?? a.refresh,
    expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : Number.MAX_SAFE_INTEGER,
  }
  await $.store.set(`account:${a.key}`, next)
  return next
}

async function gqlWith($: EngineInterface, a: Account, query: string, variables: Record<string, unknown> = {}): Promise<any> {
  const ask = (token: string) =>
    $.http.fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, variables }),
    })
  let r = await ask(a.access)
  // A token turned down is refreshed once (a new sign-in has no key yet).
  if (r.status === 401 && a.key) r = await ask((await refreshed($, a)).access)
  const out = JSON.parse(r.text || '{}')
  if (out.errors?.length) throw new Error(out.errors[0].message)
  if (!r.ok) throw new Error(`Linear answered ${r.status}`)
  return out.data
}

async function gql($: EngineInterface, key: string, query: string, variables: Record<string, unknown> = {}) {
  // The demo workspace answers from memory: no sign-in, no network.
  if (key === DEMO) return demoGql(query, variables)
  let a = await account($, key)
  if (a.expiresAt - 60_000 < Date.now()) a = await refreshed($, a)
  return gqlWith($, a, query, variables)
}

// ── What the pane shows ──────────────────────────────────────────────────────

// Open issues, work in flight first, as the popup groups them.
const STATE_TYPES = ['started', 'triage', 'unstarted', 'backlog']
const FIELDS = `identifier title branchName url priority updatedAt state { name type } team { id } project { name }`

// A status's mark and colour, as Linear draws them.
function look(statusType: string, status: string): { mark: string; color: string } {
  if (statusType === 'started') return /review/i.test(status) ? { mark: '◕', color: 'suggestion' } : { mark: '◔', color: 'warning' }
  if (statusType === 'triage') return { mark: '◇', color: 'error' }
  if (statusType === 'unstarted') return { mark: '○', color: 'text' }
  if (statusType === 'completed') return { mark: '●', color: 'success' }
  if (statusType === 'canceled') return { mark: '⊘', color: 'subtle' }
  return { mark: '◌', color: 'subtle' }
}

const PRIORITY = ['', 'Urgent', 'High', 'Medium', 'Low']

// A colour Linear sent (a status's, a label's), drawn only as the hex it should
// be: anything else falls back to the theme's.
const hex = (c: string | null | undefined) => (c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : undefined)

// A description as Linear stores it, made to read in a pane: its line breaks
// (\r\n, <br>) as newlines, and runs of blank lines as one.
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function toIssue(i: any): Issue {
  return {
    id: String(i.identifier),
    title: String(i.title ?? ''),
    status: String(i.state?.name ?? ''),
    statusType: String(i.state?.type ?? ''),
    priority: Number(i.priority ?? 0),
    project: i.project?.name ?? null,
    branch: i.branchName || null,
    url: String(i.url ?? ''),
    team: String(i.team?.id ?? ''),
    updatedAt: String(i.updatedAt ?? ''),
  }
}

async function say($: EngineInterface, text: string, link: string | null = null, isError = false) {
  await update($, notice, () => ({ text, link, isError }))
}

// Copies text where the person is, and says whether it worked: over SSH the
// terminal has to take the copy (OSC 52), and not every one does.
async function copy($: EngineInterface, text: string, surface: Parameters<EngineInterface['ui']['copy']>[0]['surface'], what: string) {
  const r = await $.ui.copy({ text, surface })
  if (r.isCopied) await say($, `${what} is copied.`)
  else await say($, `${what} couldn't be copied here (${r.reason}): select it on screen instead.`, null, true)
}

async function load($: EngineInterface, key: string) {
  await update($, loaded, all => ({ ...all, [key]: { ...(all[key] ?? { issues: [], at: 0, error: null }), isLoading: true } }))
  try {
    const d = await gql(
      $,
      key,
      `query { viewer { assignedIssues(first: 200, orderBy: updatedAt, filter: { state: { type: { nin: ["completed", "canceled"] } } }) { nodes { ${FIELDS} } } } }`,
    )
    const issues: Issue[] = d.viewer.assignedIssues.nodes.map(toIssue)
    await update($, loaded, all => ({ ...all, [key]: { issues, at: Date.now(), error: null, isLoading: false } }))
    if (key !== DEMO) await $.store.set(`issues:${key}`, issues)
  } catch (err) {
    await update($, loaded, all => ({ ...all, [key]: { ...(all[key] ?? { issues: [], at: 0 }), error: message(err), isLoading: false } }))
  }
}

// No element of an issue's screen has the ring. When the row pressed goes,
// the ring keeps its place in the order of the elements, which on that
// screen can be one of its pills: it would look selected, and Enter press
// it. So the screen is drawn first with no element, which the ring falls off,
// and then whole.
let blank = false
let draws = 0

async function openIssue($: EngineInterface, key: string, id: string) {
  blank = true
  const was = draws
  await update($, view, (): View => ({ screen: 'issue', id, picking: false }))
  for (let n = 0; n < 40 && draws === was; n++) await $.clock.sleep(10)
  blank = false
  await update($, view, v => ({ ...v }))
  try {
    const d = await gql(
      $,
      key,
      `query($id: String!) { issue(id: $id) { ${FIELDS} description dueDate priorityLabel state { color } assignee { displayName isMe } labels { nodes { name color } } cycle { number name } attachments { nodes { url title metadata } } } }`,
      { id },
    )
    const i = d.issue
    const detail: Detail = {
      ...toIssue(i),
      description: String(i.description ?? ''),
      statusColor: i.state?.color ?? null,
      priorityLabel: i.priorityLabel ?? null,
      assignee: i.assignee ? { name: String(i.assignee.displayName ?? ''), isMe: Boolean(i.assignee.isMe) } : null,
      labels: (i.labels?.nodes ?? []).map((l: any) => ({ name: String(l.name), color: l.color ?? null })),
      cycle: i.cycle ? `Cycle ${i.cycle.number}${i.cycle.name ? ` · ${i.cycle.name}` : ''}` : null,
      dueDate: i.dueDate ?? null,
      // Its PRs, open ones first, each in the state Linear's GitHub
      // integration last saw: open, draft, merged or closed.
      prs: (i.attachments?.nodes ?? [])
        .flatMap((a: any) => {
          const k = pullKey(String(a.url ?? ''))
          return k ? [{ key: k, title: String(a.title ?? k), url: String(a.url), state: prState(a.metadata) }] : []
        })
        .sort((a: { state: string }, b: { state: string }) => PR_ORDER.indexOf(a.state) - PR_ORDER.indexOf(b.state)),
    }
    await update($, details, all => ({ ...all, [id]: detail }))
  } catch (err) {
    await say($, `Couldn't read ${id}: ${message(err)}`, null, true)
  }
}

// A team's states, in the order work flows through them.
const RANK: Record<string, number> = { triage: 0, backlog: 1, unstarted: 2, started: 3, completed: 4, canceled: 5 }

async function teamStates($: EngineInterface, key: string, team: string): Promise<Status[]> {
  const known = (await read($, statuses))[team]
  if (known) return known
  const d = await gql($, key, `query($id: String!) { team(id: $id) { states(first: 250) { nodes { id name type position } } } }`, { id: team })
  const list = [...d.team.states.nodes]
    .sort((a: any, b: any) => (RANK[a.type] ?? 9) - (RANK[b.type] ?? 9) || a.position - b.position)
    .map((s: any): Status => ({ id: s.id, name: s.name, type: s.type }))
  await update($, statuses, all => ({ ...all, [team]: list }))
  return list
}

async function pickStatus($: EngineInterface, key: string, issue: Issue) {
  await update($, view, v => (v.screen === 'issue' ? { ...v, picking: true } : v))
  try {
    await teamStates($, key, issue.team)
  } catch (err) {
    await say($, `Couldn't read the team's statuses: ${message(err)}`, null, true)
  }
}

async function setStatus($: EngineInterface, key: string, issue: Issue, s: Status) {
  await update($, view, v => (v.screen === 'issue' ? { ...v, picking: false } : v))
  try {
    await gql($, key, `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }`, {
      id: issue.id,
      input: { stateId: s.id },
    })
    await say($, `${issue.id} is ${s.name} now.`)
    await openIssue($, key, issue.id)
    void load($, key)
  } catch (err) {
    await say($, `Couldn't change ${issue.id}: ${message(err)}`, null, true)
  }
}

// What a cloud session is handed for an issue.
function brief(d: Detail): string {
  return [
    `Work on Linear issue ${d.id}, "${d.title}": ${d.url}`,
    '',
    d.description.trim() || '(The issue has no description.)',
    '',
    'How to go about it:',
    `1. Start from GitHub's main: git fetch origin && git checkout -b ${d.branch ?? d.id.toLowerCase()} origin/main`,
    "2. Follow the repo's CLAUDE.md and conventions.",
    '3. Implement it, with tests. Run typecheck, lint and the relevant tests.',
    `4. Push the branch and open a DRAFT pull request referencing ${d.id}.`,
    '',
    "If something can't run in this environment, say so plainly rather than working around it silently.",
  ].join('\n')
}

const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`

// Start: the issue made yours and In Progress (the team's first started
// state), then handed to a cloud session started from this session's folder.
// `claude --cloud` wants a terminal, so it gets one from `script`.
async function start($: EngineInterface, key: string, d: Detail) {
  const cwd = await $.session.cwd()
  const repo = await $.session.repo()
  if (key === DEMO) {
    // The demo makes it yours and In Progress, and says what would follow.
    const states = await teamStates($, key, d.team)
    const started = states.find(s => s.type === 'started')
    await gql($, key, `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }`, {
      id: d.id,
      input: { assigneeId: 'me', ...(started && d.statusType !== 'started' ? { stateId: started.id } : {}) },
    })
    await say($, `Demo: ${d.id} is yours and In Progress. Out of the demo, a Claude Code cloud session would now start on it${repo?.remote ? ' from this repository' : ''}.`)
    await openIssue($, key, d.id)
    void load($, key)
    return
  }
  if (!repo?.remote) {
    await say($, `Start needs a git repository with a GitHub remote: open Claude in ${d.id}'s repository first.`, null, true)
    return
  }
  await say($, `Starting ${d.id} in the cloud…`)
  try {
    const states = await teamStates($, key, d.team)
    const started = states.find(s => s.type === 'started')
    const me = await gql($, key, `query { viewer { id } }`)
    await gql($, key, `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }`, {
      id: d.id,
      input: { assigneeId: me.viewer.id, ...(started && d.statusType !== 'started' ? { stateId: started.id } : {}) },
    })
  } catch (err) {
    await say($, `Couldn't make ${d.id} yours and In Progress: ${message(err)}`, null, true)
    return
  }
  const os = (await $.process.run(['uname'])).stdout.trim()
  const argv =
    os === 'Darwin'
      ? ['script', '-q', '/dev/null', 'claude', '--cloud', brief(d)]
      : ['script', '-qfec', ['claude', '--cloud', brief(d)].map(quote).join(' '), '/dev/null']
  try {
    const r = await $.process.run(argv, { cwd, timeoutMs: 180_000 })
    const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;?<>]*[a-zA-Z]/g, '')
    const link = /https:\/\/claude\.ai\/code\/session_[A-Za-z0-9]+/.exec(out)?.[0] ?? null
    if (!link) {
      await say($, `The cloud session didn't start: ${out.trim().split('\n').pop() ?? `exit ${r.exitCode}`}`, null, true)
      return
    }
    await say($, `${d.id} is running in the cloud.`, link)
    $.ui.toast(`${d.id} started in the cloud`)
    void load($, key)
  } catch (err) {
    await say($, `The cloud session didn't start: ${message(err)}`, null, true)
  }
}

// The issue's worktree, as herdr-linear's `w` makes it, without herdr: in
// this session's repository, on Linear's branch name for the issue (so
// Linear's GitHub integration links the pull request), beside the checkout
// at <repo>.worktrees/<branch>. One already on the branch is found, in any
// worktree of the repo; a branch that exists locally is checked out as it
// is; a new one starts from the remote's default branch, fetched first.
async function git($: EngineInterface, cwd: string, args: string[]) {
  try {
    return await $.process.run(['git', ...args], { cwd, timeoutMs: 120_000 })
  } catch (err) {
    return { exitCode: 127, stdout: '', stderr: message(err) }
  }
}

async function worktree($: EngineInterface, key: string, i: Issue) {
  if (!i.branch) return say($, `${i.id} has no branch name in Linear.`, null, true)
  const repo = await $.session.repo()
  if (key === DEMO) {
    const at = `${repo?.root ?? '~/code/halcyon/notes-app'}.worktrees/${i.branch.replace(/[^A-Za-z0-9._-]+/g, '-')}`
    return say($, `Demo: ${i.id}'s worktree would be at ${at}, on ${i.branch}. Then: cd ${at} && claude`)
  }
  if (!repo?.root) return say($, `A worktree needs this session to be in ${i.id}'s repository.`, null, true)
  // The main checkout, whichever worktree the session is in.
  const common = await git($, repo.root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  const root = common.exitCode === 0 ? common.stdout.trim().replace(/\/\.git\/?$/, '') : repo.root
  const list = await git($, root, ['worktree', 'list', '--porcelain'])
  let path: string | null = null
  for (const block of list.stdout.split('\n\n')) {
    if (block.includes(`branch refs/heads/${i.branch}`)) path = /^worktree (.+)$/m.exec(block)?.[1] ?? null
  }
  if (!path) {
    path = `${root}.worktrees/${i.branch.replace(/[^A-Za-z0-9._-]+/g, '-')}`
    const exists = (await git($, root, ['rev-parse', '--verify', '--quiet', `refs/heads/${i.branch}`])).exitCode === 0
    let r
    if (exists) {
      r = await git($, root, ['worktree', 'add', path, i.branch])
    } else {
      await git($, root, ['fetch', '--quiet', 'origin'])
      const head = await git($, root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
      const base = head.exitCode === 0 && head.stdout.trim() ? head.stdout.trim() : 'HEAD'
      r = await git($, root, ['worktree', 'add', '--no-track', '-b', i.branch, path, base])
    }
    if (r.exitCode !== 0) return say($, `Couldn't make the worktree: ${(r.stderr || r.stdout).trim().split('\n').pop()}`, null, true)
  }
  await say($, `${i.id}'s worktree is at ${path}, on ${i.branch}. Then: cd ${quote(path)} && claude`)
}

// As a dialog: it takes the keys, and Tab and the arrows walk its rows.
// Opened again while open, it takes the keyboard back (Esc gave it up).
async function openPane($: EngineInterface) {
  // As big as the layout allows: inline, as tall as it spares; docked, the
  // widest a dock opens (45% of the terminal). The person's own size wins.
  await $.ui.open({ id: PANE, title: 'Linear', focus: true, closeOnEscape: true, holdToasts: true, rows: 1000, columns: 1000 })
}

// Moves the keyboard to an element of the pane, once the pane has it again.
async function focusOn($: EngineInterface, key: string) {
  await openPane($)
  const r = await $.ui.focus({ requestId: PANE, key }).catch(() => ({ deny: 'failed' }))
  if (!r.deny) ring = key
}

// The issues the list shows, by status in the order it shows them.
function grouped(all: Issue[], f: string): Map<string, Issue[]> {
  const issues = all.filter(i => !f || `${i.id} ${i.title} ${i.project ?? ''} ${i.status}`.toLowerCase().includes(f.toLowerCase()))
  const groups = new Map<string, Issue[]>()
  for (const t of STATE_TYPES) {
    const ofType = issues.filter(i => i.statusType === t)
    // In Review before In Progress, as the popup has it; urgent first.
    ofType.sort((a, b) => Number(/review/i.test(b.status)) - Number(/review/i.test(a.status)) || (a.priority || 9) - (b.priority || 9))
    for (const i of ofType) groups.set(i.status, [...(groups.get(i.status) ?? []), i])
  }
  return groups
}

// The keyboard in the filter, at the top of the list: typing filters, and
// the arrows walk on into the issues.
async function focusFirst($: EngineInterface) {
  await update($, selected, () => 0)
  await focusOn($, 'filter')
}

// Another tab: its list from the top, loaded if it isn't. `onBar` keeps the
// highlight on the tab bar, where the ↑ that switched it left it.
async function switchTab($: EngineInterface, to: 'issues' | 'projects', onBar = false) {
  await update($, tab, () => to)
  await update($, selected, () => (onBar ? -1 : 0))
  const key = await read($, workspace)
  if (key && to === 'projects' && !(await read($, projects))[key]) void loadProjects($, key)
}

async function loadProjects($: EngineInterface, key: string) {
  await update($, projects, all => ({ ...all, [key]: { projects: all[key]?.projects ?? [], error: null, isLoading: true } }))
  try {
    const d = await gql($, key, `query { projects(first: 150, orderBy: updatedAt) { nodes { id name url progress targetDate state lead { displayName } } } }`)
    const list: Project[] = d.projects.nodes.map((p: any) => ({
      id: String(p.id),
      name: String(p.name ?? ''),
      state: String(p.state ?? ''),
      progress: Number(p.progress ?? 0),
      targetDate: p.targetDate ?? null,
      lead: p.lead?.displayName ?? null,
      url: String(p.url ?? ''),
    }))
    await update($, projects, all => ({ ...all, [key]: { projects: list, error: null, isLoading: false } }))
  } catch (err) {
    await update($, projects, all => ({ ...all, [key]: { projects: all[key]?.projects ?? [], error: message(err), isLoading: false } }))
  }
}

// A project's open issues, in the Issues tab in place of yours.
async function openProject($: EngineInterface, key: string, p: Project) {
  await update($, scope, () => ({ id: p.id, name: p.name }))
  await update($, filter, () => '')
  await update($, selected, () => 0)
  const id = `p:${p.id}`
  await update($, loaded, all => ({ ...all, [id]: { issues: all[id]?.issues ?? [], at: 0, error: null, isLoading: true } }))
  try {
    const d = await gql(
      $,
      key,
      `query($id: String!) { project(id: $id) { issues(first: 200, filter: { state: { type: { nin: ["completed", "canceled"] } } }) { nodes { ${FIELDS} } } } }`,
      { id: p.id },
    )
    const issues: Issue[] = d.project.issues.nodes.map(toIssue)
    await update($, loaded, all => ({ ...all, [id]: { issues, at: Date.now(), error: null, isLoading: false } }))
    // The keyboard on its first issue: left alone, it stays where it was in
    // the projects, on whichever issue is drawn there now.
    const first = rowsOf(await currentLines($))[0]
    await focusOn($, first ? rowKey(first) : 'filter')
  } catch (err) {
    await update($, loaded, all => ({ ...all, [id]: { issues: [], at: 0, error: message(err), isLoading: false } }))
  }
}

// Back from a project's issues to the projects, on that project.
async function leaveProject($: EngineInterface) {
  const sc = await read($, scope)
  await update($, scope, () => null)
  await update($, filter, () => '')
  const at = rowsOf(await currentLines($)).findIndex(l => l.kind === 'project' && l.project.id === sc?.id)
  await update($, selected, () => Math.max(0, at))
  await focusOn($, at >= 0 && sc ? `project-${sc.id}` : 'filter')
}

// To another mod's pane: this one closes, and this mod opens that one, by
// its id, which that mod draws. Opened here, as the answer to the person's
// press, it's drawn at any width with the keyboard in it; a pane a mod opens
// for another on its own would get neither (Claude Code holds it undrawn
// under 144 columns). What it's to show goes in its title: `⟨args⟩`, which
// that mod reads and puts right. Should it not be drawn, the command goes in
// the prompt instead, for Enter.
async function jump($: EngineInterface, command: string, args: string, name: string) {
  await $.ui.close({ id: PANE }).catch(() => undefined)
  const r = await $.ui
    .open({ id: command, title: `${name} ⟨${args}⟩`, focus: true, closeOnEscape: true, holdToasts: true, rows: 1000, columns: 1000 })
    .catch(() => ({ isPlaced: false }))
  if (r.isPlaced) return
  const text = `/${command} ${args}`
  const box = await $.prompt.read().catch(() => ({ text: '' }))
  const draft = box.text.trim()
  if (draft && !/^\/(linear|github)(\s|$)/.test(draft)) return $.ui.toast(`${text} opens ${name}.`)
  const filled = await $.prompt.fill({ text, mode: 'replace' }).catch(() => ({ isFilled: false }))
  $.ui.toast(filled.isFilled ? `Enter opens ${name}.` : `${text} opens ${name}.`)
}

// Back to the pane this one was opened from: it closes, that one opens as
// it was left.
async function goBackFrom($: EngineInterface): Promise<boolean> {
  const was = await read($, from)
  if (!was) return false
  await update($, from, () => null)
  await jump($, was, 'back', was === 'github' ? 'GitHub' : was === 'linear' ? 'Linear' : was)
  return true
}

// A pull request in the GitHub mod: there, and Esc there back here.
async function openGithub($: EngineInterface, prKey: string) {
  const demo = (await read($, workspace)) === DEMO
  await jump($, 'github', `${demo ? 'demo ' : ''}pr ${prKey} from:linear`, 'GitHub')
}

// Back to the list, the keyboard on the issue it came from.
async function back($: EngineInterface, from: string | null) {
  await update($, view, (): View => ({ screen: 'list' }))
  await update($, signin, () => null)
  // The highlight on the issue it came from, the cursor in the filter.
  const at = from ? rowsOf(await currentLines($)).findIndex(l => l.kind === 'issue' && l.issue.id === from) : -1
  await update($, selected, () => Math.max(0, at))
  // The keyboard back in the list, on the row it came from.
  await focusOn($, at >= 0 && from ? `issue-${from}` : 'filter')
}

async function signOut($: EngineInterface, key: string) {
  await $.store.set(`account:${key}`, undefined)
  const list = await update($, workspaces, all => all.filter(w => w.key !== key))
  await $.store.set('workspaces', list)
  await update($, workspace, () => list[0]?.key ?? null)
  await say($, `Signed out of ${key} here.`)
}

// What /linear and its arguments do: also how the GitHub mod's pane opens
// this one (in its title, as below).
async function arrive($: EngineInterface, args: string) {
  // A notice is for the moment it's given: none from an earlier opening.
  await update($, notice, () => null)
  const list = ((await $.store.get('workspaces')) as Workspace[] | undefined) ?? []
  await update($, workspaces, () => list)
  hasGithub = (await $.command.list().catch(() => [])).some(c => c.name === 'github')
  const words = args.trim().split(/\s+/).filter(Boolean)
  // `back`: another mod's pane closed, and this one opens as it was left.
  if (words[0] === 'back') {
    if ((await read($, view)).screen === 'list') await focusFirst($)
    else await openPane($)
    return
  }
  await update($, from, () => words.find(w => w.startsWith('from:'))?.slice(5) ?? null)
  // `issue KEY`, as another mod opens one: its screen, straight away.
  const issueAt = words.indexOf('issue')
  const wanted = issueAt >= 0 ? words[issueAt + 1]?.toUpperCase() : undefined
  if (wanted) {
    const chosen = await read($, workspace)
    const key = words.includes(DEMO) ? DEMO : chosen && list.some(w => w.key === chosen) ? chosen : list[0]?.key
    if (!key) {
      await beginSignIn($)
      await openPane($)
      return
    }
    await update($, workspace, () => key)
    await update($, scope, () => null)
    if (!(await read($, loaded))[key]) void load($, key)
    // The issue first, then the pane: opened on a screen already whole, no
    // element of it takes the ring (it would sit on Start, an Enter away).
    await openIssue($, key, wanted)
    await openPane($)
    await update($, view, x => ({ ...x }))
    return
  }
  if (words.includes(DEMO)) {
    // `/linear demo`: the made-up workspace, no account needed.
    await update($, workspace, () => DEMO)
    await update($, scope, () => null)
    await update($, view, (): View => ({ screen: 'list' }))
    await load($, DEMO)
  } else if (list.length === 0) {
    await beginSignIn($)
  } else {
    const chosen = await read($, workspace)
    const key: string = chosen && list.some(w => w.key === chosen) ? chosen : list[0]!.key
    await update($, workspace, () => key)
    // What was found last time shows at once; Linear is asked again behind it.
    const kept = await $.store.get(`issues:${key}`)
    if (Array.isArray(kept) && !(await read($, loaded))[key]) {
      await update($, loaded, l => ({ ...l, [key]: { issues: kept as Issue[], at: 0, error: null, isLoading: true } }))
    }
    if ((await read($, view)).screen === 'signin' && !(await read($, signin))) await update($, view, (): View => ({ screen: 'list' }))
    void load($, key)
  }
  // The keyboard in the filter: typing filters, ↓ walks into the issues.
  if ((await read($, view)).screen === 'list') await focusFirst($)
  else await openPane($)
  return
}

// The arguments another mod's pane opens this one with, from its title
// (`Name ⟨args⟩`), or null for an ordinary title.
export function titleArgs(title: string | undefined): string | null {
  const m = /⟨(.*)⟩/.exec(title ?? '')
  return m ? m[1]! : null
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'linear',
      description: 'Your Linear issues in a pane: read, change status, start in the cloud (`/linear demo` for a made-up workspace)',
    })
    return next(e)
  })

  on('command.run', { command: 'linear' }, async ($, e) => {
    await arrive($, e.args)
    return { text: 'Linear pane opened.' }
  })

  // The GitHub mod opens this pane itself, as the person's press there (so
  // it's drawn at any width, with the keyboard), the arguments in its title:
  // `Linear ⟨issue KEY from:x⟩`. The title is put right, then they're acted on.
  on('ui.open', async ($, e, next) => {
    const args = e.id === PANE ? titleArgs(e.title) : null
    if (args === null) return next(e)
    const r = await next({ ...e, title: 'Linear' })
    void arrive($, args)
    return r
  })


  // Esc on an issue (or a sign-in with somewhere to go back to) goes back to
  // the list, onto the issue it came from. On the list the first Esc clears
  // the filter, and the next one closes the pane.
  on('ui.close', async ($, e, next) => {
    if (e.id !== PANE || e.origin.kind !== 'person') return next(e)
    const v = await read($, view)
    const hasList = (await read($, workspaces)).length > 0
    // Picking a status: Esc closes the options alone, back on the issue.
    if (v.screen === 'issue' && v.picking) {
      await update($, view, (): View => ({ ...v, picking: false }))
      // The keyboard back to the pane, on no element, as the issue opened;
      // drawn again then, or its hotkeys stay on the frame before.
      await openPane($)
      await update($, view, x => ({ ...x }))
      return { value: undefined }
    }
    if (v.screen === 'issue' && (await goBackFrom($))) return { value: undefined }
    if (v.screen === 'issue' || (v.screen === 'signin' && hasList)) {
      await back($, v.screen === 'issue' ? v.id : null)
      // Answered here, without next: the pane stays open.
      return { value: undefined }
    }
    if (v.screen === 'list' && (await read($, filter))) {
      await update($, filter, () => '')
      await focusFirst($)
      return { value: undefined }
    }
    // Then out of a project's issues, back to the projects.
    if (v.screen === 'list' && (await read($, scope))) {
      await leaveProject($)
      return { value: undefined }
    }
    return next(e)
  })

  // As the keyboard moves through the list, the window follows it, a line
  // short of each edge, so there's always another issue to move to.
  // The cursor stays in the filter. A move away from it by the person (an
  // arrow or Tab) is kept there, and moves the highlight instead: onto an
  // element after the filter (the issues) is down, before it (the top bar)
  // is up. The highlight stops at either end.
  // The keyboard moves through the rows as Claude Code moves it; the list
  // follows it, drawn around the row it's on.
  //
  // ↑ from the filter switches the tab, the cursor staying in the filter:
  // the tabs are all there is above it, so a move from it onto one is ↑ (or
  // a click on one), and it's kept from leaving.
  on('ui.focus', async ($, e, next) => {
    const element = e.element ?? (e as { key?: string }).key
    const origin = e.origin as { kind: string; name?: string } | undefined
    const isOwn = origin?.kind === 'plugin' && /^linear(@|$)/.test(origin.name ?? '')
    if (e.requestId === PANE && !isOwn && (ring ?? 'filter') === 'filter' && element?.startsWith('tab-')) {
      await switchTab($, (await read($, tab)) === 'issues' ? 'projects' : 'issues')
      return { deny: 'The tab switched; the cursor stays in the filter.' }
    }
    if (e.requestId === PANE && element && (element.startsWith('issue-') || element.startsWith('project-'))) {
      const at = rowsOf(await currentLines($)).findIndex(l => rowKey(l) === element)
      if (at >= 0) await update($, selected, () => at)
    }
    const moved = await next(e)
    if (!moved.deny && e.requestId === PANE && element) ring = element
    return moved
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button, Markdown, Link } = table
    // The phone has no text field: no filter or pasting there.
    const Input = 'Input' in table ? table.Input : null
    // The surface's own animated regions, where it has them.
    const Client = 'Client' in table ? (table as any).Client : null
    const v = await read($, view)
    const key = await read($, workspace)
    const spaces = await read($, workspaces)
    const all = await read($, loaded)
    const note = await read($, notice)
    const mine = key ? all[key] : undefined
    const width = e.props.bodyColumns ?? 80

    const noticeRow = note && (
      <Box flexDirection="row" gap={1}>
        <Text color={note.isError ? 'error' : 'success'} wrap="wrap">
          {note.text}
        </Text>
        {note.link && <Link href={note.link} label="open session" />}
        {note.link && <Button key="copy-link" plain hotkey="l" label="copy link" onPress={p => copy($, note.link!, p.surface, 'The link')} />}
        <Button key="dismiss" plain dimColor label="×" onPress={() => update($, notice, () => null)} />
      </Box>
    )

    // An action as a coloured pill, as herdr's footers draw them. A plain
    // Button draws its hotkey before it itself (`s:`, in the accent colour).
    const pill = (props: { id: string; hotkey?: string; label: string; color: string; autoFocus?: true; onPress: (p: { surface: any }) => unknown }) => (
      <Button key={props.id} plain hotkey={props.hotkey} autoFocus={props.autoFocus} label={props.label} onPress={p => void props.onPress(p)}>
        <Text backgroundColor={props.color} color="inverseText" weight="semibold">
          {` ${props.label} `}
        </Text>
      </Button>
    )

    // Signing in to a workspace.
    if (v.screen === 'signin' || !key) {
      const s = await read($, signin)
      return (
        <Box flexDirection="column" gap={1} paddingY={1}>
          <Text weight="bold">Sign in to Linear</Text>
          {!s && <Button key="begin" autoFocus label="sign in" onPress={() => beginSignIn($)} />}
          {s && (
            <>
              <Box flexDirection="column" gap={1} marginTop={1}>
                <Text weight="semibold">1. Approve access in Linear</Text>
                <Text wrap="wrap">Open the link, or copy it to a browser anywhere, and approve. Linear asks which workspace.</Text>
                <Box flexDirection="row" gap={2}>
                  <Button key="copy-auth" hotkey="y" autoFocus label="copy the link" onPress={p => copy($, s.url, p.surface, 'The link')} />
                  <Link href={s.url} label="Approve in Linear" />
                </Box>
                <Text dimColor wrap="wrap">{s.url}</Text>
              </Box>
              <Box flexDirection="column" gap={1} marginTop={1}>
                <Text weight="semibold">2. Paste back where Linear sent you</Text>
                <Text wrap="wrap">
                  Linear then sends the browser to a localhost page, which may not load. Copy that page's whole address, Tab to the box below, paste it and press Enter.
                </Text>
                {Input ? (
                  <Input key="pasted" placeholder="http://localhost:47821/callback?code=…" submitLabel="sign in" onSubmit={text => finishSignIn($, text)} />
                ) : (
                  <Text dimColor>Sign in from a computer: the phone can't paste the address back.</Text>
                )}
                {s.isBusy && <Text dimColor>Signing in…</Text>}
                {s.error && <Text color="error" wrap="wrap">{s.error}</Text>}
              </Box>
            </>
          )}
          {noticeRow}
          {spaces.length > 0 && (
            <Button
              key="cancel-signin"
              plain
              dimColor
              label="cancel"
              onPress={async () => {
                await update($, signin, () => null)
                await update($, view, (): View => ({ screen: 'list' }))
              }}
            />
          )}
          <Text dimColor wrap="wrap">The sign-in is kept in Claude Code's plugin store on this computer.</Text>
        </Box>
      )
    }

    draws++
    // One issue.
    if (v.screen === 'issue' && blank) return <Text dimColor>Loading {v.id}…</Text>
    if (v.screen === 'issue') {
      const listed = mine?.issues.find(i => i.id === v.id)
      const d = (await read($, details))[v.id]
      const i: Issue | undefined = d ?? listed
      // No element has the ring here: the screen is taller than the pane, so
      // the arrows scroll it, and the actions are their letters. (Nor is
      // Start, which makes a cloud session, ever one stray Enter away.)
      // Back by Esc or a click: b copies the branch, as in the GitHub pane.
      const backButton = pill({ id: 'back', label: 'back', color: 'subtle', onPress: async () => ((await goBackFrom($)) ? undefined : back($, v.id)) })
      if (!i) return <Box flexDirection="column">{backButton}<Text dimColor>Loading {v.id}…</Text></Box>
      const s = look(i.statusType, i.status)
      // Laid out as herdr-linear's issue screen: the status as a pill in
      // Linear's colour for it, the priority, the title, then the fields in a
      // column, names dim, and the description under them.
      const field = (name: string, value: unknown) =>
        value ? (
          <Box flexDirection="row">
            <Box width={10} flexShrink={0}><Text dimColor>{name}</Text></Box>
            <Box flexShrink={1}>{typeof value === 'string' ? <Text wrap="wrap">{value}</Text> : (value as any)}</Box>
          </Box>
        ) : null
      const stateColor = hex(d?.statusColor) ?? s.color
      const priority = i.priority === 1 ? null : d?.priorityLabel || PRIORITY[i.priority] || null
      const inProject = await read($, scope)
      const cameFrom = await read($, from)
      const crumb = cameFrom === 'github' ? 'GitHub ›' : inProject ? `Projects › ${cut(inProject.name, 30)} ›` : 'Issues ›'
      const options = v.picking ? (await read($, statuses))[i.team] : undefined
      // Start hands the issue to a cloud session of this session's repository.
      const repo = await $.session.repo()
      const repoName = repo?.remote ? repo.remote.replace(/\.git$/, '').split(/[/:]/).slice(-2).join('/') : null
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" gap={1}>
            {backButton}
            <Text dimColor>{crumb}</Text>
            <Text weight="bold">{i.id}</Text>
          </Box>
          {/* The issue, framed in its status's colour, as Linear colours it. */}
          <Box flexDirection="column" borderStyle="round" borderColor={stateColor} paddingX={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text wrap="truncate-end">
              <Text color={stateColor} weight="bold">{i.id}</Text>
              {i.priority === 1 && <Text color="error" weight="bold"> · ! urgent</Text>}
              {priority && <Text dimColor> · {priority.toLowerCase()}</Text>}
            </Text>
            <Box flexShrink={0}><Text color={stateColor}>{s.mark} {i.status}</Text></Box>
          </Box>
          <Text weight="bold" wrap="wrap">{i.title}</Text>
          <Text> </Text>
          <Box flexDirection="column">
            {field('Project', i.project)}
            {d && field('Assignee', d.assignee ? (
              <Text wrap="wrap">{d.assignee.name}{d.assignee.isMe ? <Text dimColor> (you)</Text> : ''}</Text>
            ) : (
              <Text dimColor>nobody</Text>
            ))}
            {d && d.labels.length > 0 && field('Labels', (
              <Text wrap="wrap">
                {d.labels.map((l, n) => (
                  <Text key={`label-${n}`}>
                    {n ? '  ' : ''}<Text color={hex(l.color) ?? 'subtle'}>●</Text> {l.name}
                  </Text>
                ))}
              </Text>
            ))}
            {field('Cycle', d?.cycle)}
            {field('Due', d?.dueDate)}
            {i.branch && field('Branch', <Text color="planMode" wrap="truncate-end">{i.branch}</Text>)}
            {d && d.prs.length > 0 && field('PRs', (
              <Box flexDirection="column">
                {d.prs.map((pr, n) => {
                  // Merged and closed ones dimmed; g goes to the first (an open one, if any).
                  const look = PR_LOOK[pr.state] ?? PR_LOOK.open!
                  const isDone = pr.state === 'merged' || pr.state === 'closed'
                  return hasGithub ? (
                    <Button key={`pr-${pr.key}`} plain hotkey={n === 0 ? 'g' : undefined} label={`${pr.key} ${pr.title}`} onPress={() => openGithub($, pr.key)}>
                      <Text wrap="truncate-end">
                        <Text color={look.color}>{look.mark} </Text>
                        <Text color={isDone ? undefined : 'success'} dimColor={isDone || undefined} underline>{pr.key}</Text>
                        <Text dimColor={isDone || undefined}> {pr.title}</Text>
                        <Text color={look.color} dimColor={isDone || undefined}> · {pr.state}</Text>
                      </Text>
                    </Button>
                  ) : (
                    <Box key={`pr-${pr.key}`} flexDirection="row">
                      <Text color={look.color}>{look.mark} </Text>
                      <Link href={pr.url} label={`${pr.key} ${pr.title}`} />
                      <Text color={look.color} dimColor={isDone || undefined}> · {pr.state}</Text>
                    </Box>
                  )
                })}
              </Box>
            ))}
          </Box>
          </Box>
          {noticeRow}
          {v.picking ? (
            <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
              <Text color="warning" weight="bold">STATUS <Text dimColor>· move {i.id} to</Text></Text>
              {!options && <Text dimColor>Loading statuses…</Text>}
              {options?.map((st, n) => {
                const k = look(st.type, st.name)
                return (
                  <Button key={`status-${st.id}`} plain hotkey={n < 9 ? String(n + 1) : undefined} autoFocus={n === 0 ? true : undefined} label={st.name} onPress={() => setStatus($, key, i, st)}>
                    <Text color={k.color}>{k.mark} {st.name}</Text>
                    {st.name === i.status ? <Text dimColor> (now)</Text> : ''}
                  </Button>
                )
              })}
              <Button key="cancel-status" plain dimColor label="cancel" onPress={() => update($, view, x => (x.screen === 'issue' ? { ...x, picking: false } : x))} />
            </Box>
          ) : (
            <>
              <Box flexDirection="row" gap={1} flexWrap="wrap">
                {pill({ id: 'start', hotkey: 's', label: 'start in cloud', color: 'claude', onPress: () => d && start($, key, d) })}
                {pill({ id: 'worktree', hotkey: 'w', label: 'worktree', color: 'claude', onPress: () => worktree($, key, i) })}
                {pill({ id: 'status', hotkey: 'c', label: 'status', color: 'warning', onPress: () => pickStatus($, key, i) })}
                {pill({ id: 'copy-url', hotkey: 'y', label: 'copy link', color: 'suggestion', onPress: p => copy($, i.url, p.surface, 'The link') })}
                {i.branch && pill({ id: 'branch', hotkey: 'b', label: 'copy branch', color: 'suggestion', onPress: p => copy($, i.branch!, p.surface, 'The branch') })}
                {/* A terminal that can't open links (or wraps a long one) has the copy. */}
                <Link href={i.url} label="open in Linear" />
              </Box>
              <Text dimColor wrap="wrap">
                {repoName && key !== DEMO ? `Start runs it in the cloud from ${repoName}, this session's repository.` : repoName ? "Start runs it in the cloud from this session's repository." : "Start needs this session to be in the issue's repository."}
              </Text>
            </>
          )}
          <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
            <Text color="suggestion" weight="bold">DESCRIPTION</Text>
            {d ? (d.description.trim() ? <Markdown key={`md-${i.id}`} text={tidy(d.description)} /> : <Text dimColor>No description.</Text>) : <Text dimColor>Loading…</Text>}
          </Box>
        </Box>
      )
    }

    // The list: the tab's rows, grouped by status, as buttons the arrows move
    // between. The arrows walk a pane's rows only while it fits, so the list
    // draws the lines there's room for, around the row the keyboard is on.
    const f = (await read($, filter)).toLowerCase()
    const which = await read($, tab)
    const sc = await read($, scope)
    const proj = (await read($, projects))[key]
    // A project open shows its issues, over the tabs, as an issue's screen does.
    const showsProjects = which === 'projects' && !sc
    const source = sc ? all[`p:${sc.id}`] : which === 'issues' ? mine : undefined
    const project = sc ? proj?.projects.find(p => p.id === sc.id) : undefined
    const listed = showsProjects ? projectLines(proj?.projects ?? [], f) : lines(grouped(source?.issues ?? [], f))
    const rows = rowsOf(listed)
    const isLoading = showsProjects ? Boolean(proj?.isLoading) : Boolean(source?.isLoading)
    const error = showsProjects ? proj?.error : source?.error
    const sel = Math.max(0, Math.min(await read($, selected), rows.length - 1))
    // The header, the filter, the gaps and the workspaces' row take about
    // 12 lines;
    // a note or an error two more, a project's header one.
    room = Math.max(5, (e.props.scroll?.bodyRows ?? 24) - 13 - (note ? 2 : 0) - (error ? 2 : 0) - (sc ? 1 : 0))
    // Centred on the keyboard's row, so a held arrow finds rows drawn ahead.
    const selLine = rows[sel] ? listed.indexOf(rows[sel]!) : 0
    const t = Math.max(0, Math.min(selLine - Math.floor(room / 2), listed.length - room))
    const shown = listed.slice(t, t + room)
    // A window opening inside a status still says which.
    const lead = shown[0] && shown[0].kind !== 'head' && shown[0].kind !== 'gap' ? [...listed.slice(0, t)].reverse().find(l => l.kind === 'head') : undefined
    const above = rowsOf(listed.slice(0, t)).length
    const below = rowsOf(listed.slice(t + room)).length
    const open = (l: Line | undefined) =>
      l?.kind === 'issue' ? openIssue($, key, l.issue.id) : l?.kind === 'project' ? openProject($, key, l.project) : undefined
    // Issue keys padded to the longest in the list, so titles line up.
    const idWidth = Math.max(0, ...rows.map(l => (l.kind === 'issue' ? l.issue.id.length : 0)))
    const tabButton = (id: 'issues' | 'projects', name: string, n: number | null) => {
      const isOn = which === id
      return (
        <Button
          key={`tab-${id}`}
          plain
          onPress={async () => {
            await switchTab($, id)
            await focusOn($, 'filter')
          }}
        >
          <Text inverse={isOn || undefined} weight={isOn ? 'semibold' : undefined} color={isOn ? 'suggestion' : undefined}>
            {` ${name}${n === null ? '' : ` ${n}`} `}
          </Text>
        </Button>
      )
    }
    const hint = sc
      ? width >= 70
        ? 'Type to filter · ↓ to the list · Enter opens the first · Esc back to the projects'
        : 'Type to filter… · ↓ list · Esc back'
      : width >= 70
        ? `Type to filter · ↓ to the list · ↑ switches to ${which === 'issues' ? 'Projects' : 'Issues'} · Enter opens the first`
        : `Type to filter… · ↓ list · ↑ ${which === 'issues' ? 'Projects' : 'Issues'}`

    return (
      <Box flexDirection="column" gap={1}>
        {sc ? (
          // A project's screen, topped as an issue's is: back, the crumb, its
          // name; then its state as a pill in its colour, and the rest.
          <Box flexDirection="column">
            <Box flexDirection="row" gap={1}>
              {pill({ id: 'crumb-projects', label: 'back', color: 'subtle', onPress: () => leaveProject($) })}
              <Text dimColor>Projects ›</Text>
              <Text weight="bold" wrap="truncate-end">{sc.name}</Text>
              <Text dimColor>{isLoading ? ' loading…' : ''}</Text>
            </Box>
            {project && (
              <Box flexDirection="row" gap={1} flexWrap="wrap">
                <Text backgroundColor={look(project.state === 'planned' ? 'unstarted' : project.state, project.state).color} color="inverseText" weight="semibold">
                  {` ${project.state[0]!.toUpperCase() + project.state.slice(1)} `}
                </Text>
                <Text dimColor>· {Math.round(project.progress * 100)}%{project.lead ? ` · ${project.lead}` : ''}{project.targetDate ? ` · due ${project.targetDate}` : ''} ·</Text>
                <Link href={project.url} label="open in Linear" />
                <Button key="copy-project-url" plain hotkey="y" label="copy link" onPress={p => copy($, project.url, p.surface, 'The link')} />
              </Box>
            )}
          </Box>
        ) : (
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            {tabButton('issues', 'Issues', mine?.issues.length ?? null)}
            {tabButton('projects', 'Projects', proj ? proj.projects.filter(p => PROJECT_STATES.includes(p.state)).length : null)}
            <Text dimColor>{isLoading ? ' loading…' : ' '}</Text>
          </Box>
        )}
        {/* Under the tabs, a rule that runs while Linear is being asked. */}
        {Client && <Client key="list-rail" module="./rail.tsx" props={{ active: isLoading, color: 'suggestion', width }} />}
        {Input && (
          <Input
            key="filter"
            autoFocus
            // Short, so the field never wraps and moves the list as it takes
            // the keyboard: one word beside Claude Code's own ⏎.
            submitLabel="open"
            placeholder={hint}
            value={f}
            onInput={async text => {
              await update($, filter, () => text)
              await update($, selected, () => 0)
            }}
            onSubmit={() => open(rows[0])}
          />
        )}
        {noticeRow}
        {error && <Text color="error" wrap="wrap">{error}</Text>}
        {!isLoading && rows.length === 0 && !error && (
          <Text dimColor>{f ? 'Nothing matches.' : which === 'projects' ? 'No open projects.' : sc ? 'No open issues in this project.' : 'Nothing open is assigned to you.'}</Text>
        )}
        {listed.length > 0 && (
          <Box flexDirection="column">
            <Text dimColor>{above ? `↑ ${above} more` : ' '}</Text>
            {[...(lead ? [lead] : []), ...shown].map(l => {
              if (l.kind === 'gap') return <Text> </Text>
              if (l.kind === 'head') {
                const s = look(l.type, l.status)
                return (
                  <Text>
                    <Text color={s.color} weight="semibold">{l.status}</Text> <Text dimColor>{l.count}</Text>
                  </Text>
                )
              }
              if (l.kind === 'project') {
                const p = l.project
                const s = look(p.state === 'planned' ? 'unstarted' : p.state, p.state)
                const extra = [`${Math.round(p.progress * 100)}%`, p.lead, p.targetDate].filter(Boolean).join(' · ')
                // Its progress as a gauge, in its state's colour.
                const filled = Math.round(p.progress * 6)
                return (
                  <Button key={rowKey(l)} plain onPress={() => openProject($, key, p)}>
                    <Text color={s.color}>{s.mark}</Text>
                    <Text> {cut(p.name, Math.max(12, width - extra.length - 14))} </Text>
                    <Text color={s.color}>{'▰'.repeat(filled)}</Text>
                    <Text dimColor>{'▱'.repeat(6 - filled)} {extra}</Text>
                  </Button>
                )
              }
              const i = l.issue
              const s = look(i.statusType, i.status)
              const row = fit(i, width, idWidth)
              return (
                <Button key={rowKey(l)} plain onPress={() => openIssue($, key, i.id)}>
                  <Text color={s.color}>{s.mark} {i.id.padEnd(idWidth)}</Text>
                  <Text> {row.title}</Text>
                  {i.priority === 1 ? <Text color="error"> urgent</Text> : ''}
                  {row.project && !sc ? <Text dimColor> · {row.project}</Text> : ''}
                </Button>
              )
            })}
            <Text dimColor>{below ? `↓ ${below} more` : ' '}</Text>
          </Box>
        )}
        {/* The workspaces and signing out, below the list: out of the arrows'
            way between the filter and the tabs. */}
        {!sc && key === DEMO && (
          <Text dimColor>Halcyon · a made-up workspace: nothing here is real · /linear for yours</Text>
        )}
        {!sc && key !== DEMO && (
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            {spaces.map(w => (
              <Button
                key={`ws-${w.key}`}
                plain
                dimColor={w.key !== key ? true : undefined}
                label={w.name}
                onPress={async () => {
                  await update($, workspace, () => w.key)
                  await update($, scope, () => null)
                  await load($, w.key)
                  if (which === 'projects') await loadProjects($, w.key)
                }}
              />
            ))}
            <Button key="add" plain dimColor label="+ workspace" onPress={() => beginSignIn($)} />
            <Button key="signout" plain dimColor label="sign out" onPress={() => signOut($, key)} />
          </Box>
        )}
      </Box>
    )
  })
}

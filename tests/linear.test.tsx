import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'linear',
  component: 'Pane',
  requestId: 'linear',
  props: {
    title: 'Linear',
    isFocused: true,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const node = (id: string, title: string, state: [string, string], priority: number, extra: object = {}) => ({
  identifier: id,
  title,
  branchName: `sam/${id.toLowerCase()}`,
  url: `https://linear.app/halcyon/issue/${id}`,
  priority,
  updatedAt: '2026-10-31T12:00:00Z',
  state: { name: state[0], type: state[1] },
  team: { id: 'team-a' },
  project: { name: 'Polish' },
  ...extra,
})

const ISSUES = [
  node('HAL-231', 'Search drops accents in note titles', ['In Progress', 'started'], 1),
  node('HAL-212', 'In review one', ['In Review', 'started'], 3),
  node('HAL-240', 'Next up', ['Todo', 'unstarted'], 0),
]

const PROJECTS = [
  { id: 'p1', name: 'Offline Sync', url: 'https://linear.app/p/p1', progress: 0.4, targetDate: '2026-11-30', state: 'started', lead: { displayName: 'Sam Rivera' } },
  { id: 'p2', name: 'Export Everything', url: 'https://linear.app/p/p2', progress: 0, targetDate: null, state: 'planned', lead: null },
  { id: 'p3', name: 'Shipped long ago', url: 'https://linear.app/p/p3', progress: 1, targetDate: null, state: 'completed', lead: null },
]

const STATES = [
  { id: 's-done', name: 'Done', type: 'completed', position: 4 },
  { id: 's-todo', name: 'Todo', type: 'unstarted', position: 1 },
  { id: 's-prog', name: 'In Progress', type: 'started', position: 2 },
]

// The keys of the list's rows drawn, in order.
async function options(ui: any): Promise<string[]> {
  return ((await ui.findAll({ type: 'Button' })) as any[]).map(b => String(b.key)).filter(k => /^(issue|project)-/.test(k))
}

// Lets the work a hook started behind it settle.
async function settle() {
  for (let n = 0; n < 300; n++) await Promise.resolve()
}

// A stand-in Linear: its token endpoint and GraphQL API, and a store in memory.
function fakeLinear(on: any, store: Map<string, unknown>, issues: unknown[] = ISSUES) {
  const sent: { query: string; variables: any }[] = []
  const tokens: string[] = []
  on('store.get', (_: unknown, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: any) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('http.fetch', (_: unknown, e: any) => {
    const ok = (x: unknown) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(x), requestId: '' } as any })
    if (e.url.endsWith('/oauth/token')) {
      tokens.push(e.init.body)
      return ok({ access_token: 'tok-1', refresh_token: 'ref-1', expires_in: 86400 })
    }
    const { query, variables } = JSON.parse(e.init.body)
    sent.push({ query, variables })
    if (query.includes('organization')) return ok({ data: { viewer: { organization: { name: 'Halcyon', urlKey: 'halcyon' } } } })
    if (query.includes('assignedIssues')) return ok({ data: { viewer: { assignedIssues: { nodes: issues } } } })
    if (query.includes('projects(first')) return ok({ data: { projects: { nodes: PROJECTS } } })
    if (query.includes('project(id')) return ok({ data: { project: { issues: { nodes: [node('HAL-250', 'In the project', ['Todo', 'unstarted'], 3)] } } } })
    if (query.includes('issue(id')) return ok({ data: { issue: { ...ISSUES[0], description: 'Searching for **cafe** misses Café.', priorityLabel: 'Urgent', state: { name: 'In Progress', type: 'started', color: '#f2c94c' }, assignee: { displayName: 'Sam Rivera', isMe: true }, labels: { nodes: [{ name: 'bug', color: '#eb5757' }, { name: 'search', color: 'red; evil' }] }, cycle: { number: 14, name: 'Search polish' } } } })
    if (query.includes('team(id')) return ok({ data: { team: { states: { nodes: STATES } } } })
    if (query.includes('viewer { id }')) return ok({ data: { viewer: { id: 'me-1' } } })
    if (query.includes('issueUpdate')) return ok({ data: { issueUpdate: { success: true } } })
    return ok({ data: {} })
  })
  return { sent, tokens }
}

function engine(on: any) {
  on('command.register', () => ({ value: { command: 'linear' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.repo', () => ({ value: { root: '/repo', remote: 'https://github.com/example/notes-app.git' } as any }))
}

test('signing in: the approval link, then the pasted address traded for tokens', async ($, on) => {
  const store = new Map<string, unknown>()
  engine(on)
  const { tokens } = fakeLinear(on, store)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await ($.command.run as any)({ command: 'linear', args: '' })
  await settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const link = await ui.find({ type: 'Link' })
  expect(link).toBeDefined()
  const href = String((link as any).props?.href ?? '')
  expect(href).toContain('client_id=446107c5f38f5735e179c8e06af26ca0')
  expect(href).toContain('code_challenge_method=S256')
  const state = new URL(href).searchParams.get('state')

  // A wrong address is turned down.
  await ui.input({ key: 'pasted', text: 'http://localhost:47821/callback?code=x&state=wrong', kind: 'submit' })
  await settle()
  expect(await ui.find({ type: 'Text', text: /isn't the address/ })).toBeDefined()

  await ui.input({ key: 'pasted', text: `http://localhost:47821/callback?code=abc&state=${state}`, kind: 'submit' })
  await settle()
  expect(tokens[0]).toContain('grant_type=authorization_code')
  expect(tokens[0]).toContain('code=abc')
  expect(tokens[0]).toContain('code_verifier=')
  expect((store.get('account:halcyon') as any)?.access).toBe('tok-1')
  expect(store.get('workspaces')).toEqual([{ key: 'halcyon', name: 'Halcyon' }])
  expect(await options(ui)).toContain('issue-HAL-231')
  await ui.unmount()
})

test('the list by status, an issue, and Start in the cloud', async ($, on) => {
  const store = new Map<string, unknown>([
    ['workspaces', [{ key: 'halcyon', name: 'Halcyon' }]],
    ['account:halcyon', { key: 'halcyon', name: 'Halcyon', access: 'tok-1', refresh: 'ref-1', expiresAt: Date.now() + 3_600_000 }],
  ])
  engine(on)
  const { sent } = fakeLinear(on, store)
  const ran: string[][] = []
  on('process.run', (_: unknown, e: any) => {
    ran.push([...e.argv])
    if (e.argv[0] === 'uname') return { value: { exitCode: 0, stdout: 'Linux\n', stderr: '' } as any }
    return { value: { exitCode: 0, stdout: 'Created cloud session: Search accents\nView: https://claude.ai/code/session_01ABC?from=cli\n', stderr: '' } as any }
  })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await ($.command.run as any)({ command: 'linear', args: '' })
  await settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // Grouped by status, In Review first, each row its mark, key and title.
  expect(await ui.find({ type: 'Text', text: /^In Review$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Todo$/ })).toBeDefined()
  expect(await options(ui)).toEqual(['issue-HAL-212', 'issue-HAL-231', 'issue-HAL-240'])

  await ui.press({ key: 'issue-HAL-231' })
  await settle()
  expect(await ui.find({ type: 'Text', text: /sam\/hal-231/ })).toBeDefined()
  // Laid out as herdr-linear's: the status a pill in Linear's colour, the
  // fields with who's you, the labels' own colours, the cycle, the description.
  expect(((await ui.find({ type: 'Text', text: ' In Progress ' })) as any)?.props?.backgroundColor).toBe('#f2c94c')
  expect(await ui.find({ type: 'Text', text: '! Urgent' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: / \(you\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Cycle 14 · Search polish/ })).toBeDefined()
  const dots = (await ui.findAll({ type: 'Text', text: '●' })) as any[]
  expect(dots.map(t => t.props.color).filter(Boolean)).toEqual(['#eb5757', 'subtle'])
  expect(await ui.find({ type: 'Markdown', text: /\*\*cafe\*\*/ })).toBeDefined()

  await ui.press({ key: 'status' })
  await settle()
  expect(await ui.find({ type: 'Button', key: 'status-s-prog' })).toBeDefined()
  await ui.press({ key: 'cancel-status' })
  await settle()

  await ui.press({ key: 'start' })
  await settle()
  const assign = sent.find(s => s.query.includes('issueUpdate'))
  expect(assign?.variables).toEqual({ id: 'HAL-231', input: { assigneeId: 'me-1' } })
  const script = ran.find(a => a[0] === 'script')!
  expect(script.slice(0, 2)).toEqual(['script', '-qfec'])
  expect(script[2]).toContain("'claude' '--cloud' 'Work on Linear issue HAL-231")
  expect(await ui.find({ type: 'Text', text: /HAL-231 is running in the cloud/ })).toBeDefined()
  await ui.unmount()
})

test('the pane draws on every surface', async ($, on) => {
  const store = new Map<string, unknown>([
    ['workspaces', [{ key: 'halcyon', name: 'Halcyon' }]],
    ['account:halcyon', { key: 'halcyon', name: 'Halcyon', access: 'tok-1', refresh: null, expiresAt: Date.now() + 3_600_000 }],
  ])
  engine(on)
  fakeLinear(on, store)
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  await ($.command.run as any)({ command: 'linear', args: '' })
  await settle()
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await options(ui)).toContain('issue-HAL-240')
    await ui.unmount()
  }
})

test('the list is drawn around the keyboard\'s row, and back from an issue stays there', async ($, on) => {
  const many = Array.from({ length: 40 }, (_, n) => node(`HAL-${3000 + n}`, `Issue ${n}`, ['Todo', 'unstarted'], 3))
  const store = new Map<string, unknown>([
    ['workspaces', [{ key: 'halcyon', name: 'Halcyon' }]],
    ['account:halcyon', { key: 'halcyon', name: 'Halcyon', access: 'tok-1', refresh: null, expiresAt: Date.now() + 3_600_000 }],
  ])
  engine(on)
  fakeLinear(on, store, many)
  on('ui.focus', () => ({}))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await ($.command.run as any)({ command: 'linear', args: '' })
  await settle()

  const short = { ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 24 } } }
  let ui = await $.ui.mount({ ...short, surface: 'terminal' })
  // What fits: the start of the list, and what's below it.
  expect(await options(ui)).toContain('issue-HAL-3000')
  expect(await options(ui)).not.toContain('issue-HAL-3030')
  expect(await ui.find({ type: 'Text', text: /↓ \d+ more/ })).toBeDefined()
  await ui.unmount()

  // The keyboard moves down the rows: the list is drawn around it.
  await $.ui.focus({ requestId: 'linear', key: 'issue-HAL-3025' } as any)
  await settle()
  ui = await $.ui.mount({ ...short, surface: 'terminal' })
  expect(await options(ui)).toContain('issue-HAL-3025')
  expect(await options(ui)).toContain('issue-HAL-3028')
  expect(await ui.find({ type: 'Text', text: /↑ \d+ more/ })).toBeDefined()

  // Into that issue and back: the list is still around it.
  await ui.press({ key: 'issue-HAL-3025' })
  await settle()
  await ui.press({ key: 'back' })
  await settle()
  await ui.unmount()
  ui = await $.ui.mount({ ...short, surface: 'terminal' })
  expect(await options(ui)).toContain('issue-HAL-3025')
  await ui.unmount()
})

test('Projects: a tab of its own; a project opens as its own screen, and its crumb goes back', async ($, on) => {
  const store = new Map<string, unknown>([
    ['workspaces', [{ key: 'halcyon', name: 'Halcyon' }]],
    ['account:halcyon', { key: 'halcyon', name: 'Halcyon', access: 'tok-1', refresh: null, expiresAt: Date.now() + 3_600_000 }],
  ])
  engine(on)
  fakeLinear(on, store)
  on('ui.focus', () => ({}))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await ($.command.run as any)({ command: 'linear', args: '' })
  await settle()

  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'tab-projects' })
  await settle()
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // Open projects only, started first.
  expect(await options(ui)).toEqual(['project-p1', 'project-p2'])

  await ui.press({ key: 'project-p1' })
  await settle()
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // The project's own screen: its name and state over its issues, no tabs.
  expect(await options(ui)).toEqual(['issue-HAL-250'])
  expect(await ui.find({ type: 'Text', text: /^Offline Sync$/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'tab-issues' })).toBeUndefined()

  // An issue opened from the project says where it was opened from.
  await ui.press({ key: 'issue-HAL-250' })
  await settle()
  expect(await ui.find({ type: 'Text', text: 'Projects › Offline Sync ›' })).toBeDefined()
  await ui.press({ key: 'back' })
  await settle()
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await options(ui)).toEqual(['issue-HAL-250'])

  // Its crumb (as Esc does) back to the projects, on that project.
  await ui.press({ key: 'crumb-projects' })
  await settle()
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await options(ui)).toEqual(['project-p1', 'project-p2'])

  // The Issues tab: your issues, not the project's.
  await ui.press({ key: 'tab-issues' })
  await settle()
  await ui.unmount()
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await options(ui)).toContain('issue-HAL-231')
  await ui.unmount()
})

test('↑ from the filter switches the tab, the cursor staying in the filter', async ($, on) => {
  const store = new Map<string, unknown>([
    ['workspaces', [{ key: 'halcyon', name: 'Halcyon' }]],
    ['account:halcyon', { key: 'halcyon', name: 'Halcyon', access: 'tok-1', refresh: null, expiresAt: Date.now() + 3_600_000 }],
  ])
  engine(on)
  fakeLinear(on, store)
  on('ui.focus', () => ({}))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await ($.command.run as any)({ command: 'linear', args: '' })
  await settle()

  // ↑ lands on a tab, above the filter: kept, and the tab switches.
  const r = await $.ui.focus({ requestId: 'linear', key: 'tab-issues' } as any)
  expect((r as any).deny).toContain('cursor stays in the filter')
  await settle()
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await options(ui)).toEqual(['project-p1', 'project-p2'])
  await ui.unmount()

  // And again, back to Issues.
  await $.ui.focus({ requestId: 'linear', key: 'tab-projects' } as any)
  await settle()
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await options(ui)).toContain('issue-HAL-231')
  await ui.unmount()
})

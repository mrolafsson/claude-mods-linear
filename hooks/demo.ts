// The demo workspace: Halcyon, a made-up notes-app company, answering the
// pane's queries from memory as Linear's API would. Everything works (statuses
// change, issues start), and nothing is real: it never contacts Linear, reads
// no sign-in and starts no cloud session. It's also how the README's
// screenshots are made, so no real issue or project can end up in them.

export const DEMO = 'demo'

type DemoIssue = {
  identifier: string
  title: string
  state: string
  priority: number
  project: string | null
  labels: [string, string][]
  due: string | null
  mine: boolean
  description: string
}

const TEAM = 'team-hal'

const STATES = [
  { id: 's-triage', name: 'Triage', type: 'triage', color: '#fc7840', position: 0 },
  { id: 's-backlog', name: 'Backlog', type: 'backlog', color: '#bec2c8', position: 1 },
  { id: 's-todo', name: 'Todo', type: 'unstarted', color: '#e2e2e2', position: 2 },
  { id: 's-progress', name: 'In Progress', type: 'started', color: '#f2c94c', position: 3 },
  { id: 's-review', name: 'In Review', type: 'started', color: '#5e6ad2', position: 4 },
  { id: 's-done', name: 'Done', type: 'completed', color: '#5e6ad2', position: 5 },
  { id: 's-canceled', name: 'Canceled', type: 'canceled', color: '#95a2b3', position: 6 },
]

const PROJECTS = [
  { id: 'p-sync', name: 'Offline Sync', state: 'started', progress: 0.62, targetDate: '2026-11-28', lead: 'Sam Rivera' },
  { id: 'p-search', name: 'Search 2.0', state: 'started', progress: 0.35, targetDate: '2026-12-12', lead: 'Priya Nair' },
  { id: 'p-export', name: 'Export Everything', state: 'planned', progress: 0.1, targetDate: '2027-01-30', lead: 'Sam Rivera' },
  { id: 'p-hardening', name: 'Platform Hardening', state: 'planned', progress: 0, targetDate: null, lead: 'Jonas Berg' },
  { id: 'p-themes', name: 'Themes', state: 'paused', progress: 0.2, targetDate: null, lead: null },
]

const ISSUES: DemoIssue[] = [
  {
    identifier: 'HAL-212', title: 'Resolve conflicting offline edits with a three-way merge', state: 's-review', priority: 2,
    project: 'Offline Sync', labels: [['sync', '#26b5ce']], due: '2026-11-14', mine: true,
    description: 'Two devices editing the same note offline both win today, and the last one to sync wipes the other.\n\n## Fix\n\nMerge the two edits against their common ancestor, and keep both versions where they clash.',
  },
  {
    identifier: 'HAL-231', title: 'Search index drops accents in note titles', state: 's-progress', priority: 1,
    project: 'Search 2.0', labels: [['bug', '#eb5757'], ['search', '#4ea7fc']], due: '2026-11-07', mine: true,
    description: 'Searching for `cafe` doesn\'t find a note titled *Café notes*. Bodies are folded to ASCII, titles aren\'t.\n\n## Repro\n\n1. Create a note titled **Crème brûlée**\n2. Search for `creme`\n3. Nothing comes back\n\n## Fix\n\nFold titles the same way we fold bodies, at index time.',
  },
  {
    identifier: 'HAL-198', title: 'Share sheet remembers the last chosen folder', state: 's-progress', priority: 3,
    project: null, labels: [], due: null, mine: true,
    description: 'Saving from the share sheet always starts in *Inbox*. Start where the last note was saved instead.',
  },
  {
    identifier: 'HAL-240', title: 'Markdown export keeps inline images', state: 's-todo', priority: 2,
    project: 'Export Everything', labels: [['export', '#bb87fc']], due: null, mine: true,
    description: 'Exported Markdown links images to paths that don\'t exist outside the app. Copy them next to the file.',
  },
  {
    identifier: 'HAL-247', title: 'Rate-limit the public share endpoint', state: 's-todo', priority: 2,
    project: 'Platform Hardening', labels: [['security', '#f2994a']], due: null, mine: true,
    description: 'A shared link can be hammered without limit. Add a per-IP limit with a friendly page past it.',
  },
  {
    identifier: 'HAL-244', title: 'Keyboard shortcut cheat sheet (⌘/)', state: 's-todo', priority: 4,
    project: null, labels: [], due: null, mine: true,
    description: 'A sheet of every shortcut, opened with ⌘/.',
  },
  {
    identifier: 'HAL-252', title: 'Crash when pasting a 40 MB table', state: 's-triage', priority: 1,
    project: null, labels: [['bug', '#eb5757']], due: null, mine: true,
    description: 'Pasting a very large table from a spreadsheet crashes the editor on iPad.',
  },
  {
    identifier: 'HAL-163', title: 'Import notes from Bear', state: 's-backlog', priority: 3,
    project: 'Export Everything', labels: [['import', '#bb87fc']], due: null, mine: true,
    description: 'Read Bear\'s export, tags and all.',
  },
  {
    identifier: 'HAL-150', title: 'Themeable accent colours', state: 's-backlog', priority: 4,
    project: 'Themes', labels: [], due: null, mine: true,
    description: 'Let people pick the accent colour.',
  },
  {
    identifier: 'HAL-171', title: 'Nested tags in the sidebar', state: 's-backlog', priority: 0,
    project: null, labels: [], due: null, mine: true,
    description: 'Show `work/clients` under `work`.',
  },
  {
    identifier: 'HAL-218', title: 'Sync status in the toolbar', state: 's-todo', priority: 3,
    project: 'Offline Sync', labels: [['sync', '#26b5ce']], due: null, mine: false,
    description: 'Say when the last sync was, and whether one is running.',
  },
  {
    identifier: 'HAL-226', title: 'Queue edits made while offline', state: 's-progress', priority: 2,
    project: 'Offline Sync', labels: [['sync', '#26b5ce']], due: '2026-11-21', mine: false,
    description: 'Keep edits made offline in order, and send them when back online.',
  },
]

// The demo issues with a pull request in the GitHub mod's demo org: their
// branches are those PRs' branches, and the PRs are attached.
const PULLS: Record<string, { branch: string; repo: string; number: number; title: string }> = {
  'HAL-212': { branch: 'sam/hal-212-offline-conflicts', repo: 'halcyon/notes-app', number: 482, title: 'Offline edits survive a sync conflict' },
  'HAL-231': { branch: 'sam/hal-231-search-accents', repo: 'halcyon/notes-app', number: 479, title: 'Search index drops accents' },
  'HAL-240': { branch: 'jonas/hal-240-export-images', repo: 'halcyon/notes-app', number: 471, title: 'Markdown export keeps inline images' },
}

// Changes made in the demo, for this session: statuses and assignees.
const changed: Record<string, { state?: string; mine?: boolean }> = {}

const issueNode = (i: DemoIssue) => {
  const now = { ...i, ...changed[i.identifier] }
  const state = STATES.find(s => s.id === now.state)!
  const project = PROJECTS.find(p => p.name === now.project)
  return {
    identifier: now.identifier,
    title: now.title,
    branchName: PULLS[now.identifier]?.branch ?? `sam/${now.identifier.toLowerCase()}-${now.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}`,
    url: `https://linear.app/halcyon/issue/${now.identifier}`,
    priority: now.priority,
    priorityLabel: ['No priority', 'Urgent', 'High', 'Medium', 'Low'][now.priority],
    updatedAt: '2026-10-31T12:00:00Z',
    state: { name: state.name, type: state.type, color: state.color },
    team: { id: TEAM },
    project: project ? { name: project.name } : null,
    description: now.description,
    dueDate: now.due,
    assignee: now.mine ? { displayName: 'Sam Rivera', isMe: true } : { displayName: 'Priya Nair', isMe: false },
    labels: { nodes: now.labels.map(([name, color]) => ({ name, color })) },
    cycle: { number: 14, name: 'Search polish' },
    attachments: {
      nodes: PULLS[now.identifier]
        ? [{ url: `https://github.com/${PULLS[now.identifier]!.repo}/pull/${PULLS[now.identifier]!.number}`, title: PULLS[now.identifier]!.title }]
        : [],
    },
  }
}

const isOpen = (i: DemoIssue) => {
  const type = STATES.find(s => s.id === (changed[i.identifier]?.state ?? i.state))!.type
  return type !== 'completed' && type !== 'canceled'
}

// Answers a query the pane sends Linear, as Linear would.
export function demoGql(query: string, variables: Record<string, unknown>): any {
  if (query.includes('organization')) return { viewer: { organization: { name: 'Halcyon', urlKey: DEMO } } }
  if (query.includes('assignedIssues')) {
    return { viewer: { assignedIssues: { nodes: ISSUES.filter(i => (changed[i.identifier]?.mine ?? i.mine) && isOpen(i)).map(issueNode) } } }
  }
  if (query.includes('projects(first')) {
    return {
      projects: {
        nodes: PROJECTS.map(p => ({ ...p, url: `https://linear.app/halcyon/project/${p.id}`, lead: p.lead ? { displayName: p.lead } : null })),
      },
    }
  }
  if (query.includes('project(id')) {
    const p = PROJECTS.find(x => x.id === variables.id)
    return { project: { issues: { nodes: ISSUES.filter(i => i.project === p?.name && isOpen(i)).map(issueNode) } } }
  }
  if (query.includes('issue(id')) {
    const i = ISSUES.find(x => x.identifier === variables.id)
    if (!i) throw new Error(`No issue ${String(variables.id)} in the demo.`)
    return { issue: issueNode(i) }
  }
  if (query.includes('team(id')) return { team: { states: { nodes: STATES } } }
  if (query.includes('viewer { id }')) return { viewer: { id: 'me' } }
  if (query.includes('issueUpdate')) {
    const id = String(variables.id)
    const input = (variables.input ?? {}) as { stateId?: string; assigneeId?: string }
    changed[id] = { ...changed[id], ...(input.stateId ? { state: input.stateId } : {}), ...(input.assigneeId ? { mine: true } : {}) }
    return { issueUpdate: { success: true } }
  }
  return {}
}

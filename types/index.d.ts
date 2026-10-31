// What the Linear pane keeps for the session. Tokens are not here: they are in
// the plugin's store, on this machine only.

export type Issue = {
  id: string
  title: string
  status: string
  statusType: string
  priority: number
  project: string | null
  branch: string | null
  url: string
  // The team's id, which its statuses are looked up by.
  team: string
  updatedAt: string
}

// An issue as its screen shows it, as herdr-linear's does: Linear's own
// colours for its status and labels (hex), and who it's assigned to.
export type Detail = Issue & {
  description: string
  statusColor: string | null
  priorityLabel: string | null
  assignee: { name: string; isMe: boolean } | null
  labels: { name: string; color: string | null }[]
  cycle: string | null
  dueDate: string | null
  // Its GitHub pull requests, from its attachments: owner/repo#n.
  prs: { key: string; title: string; url: string }[]
}

export type Status = { id: string; name: string; type: string }

// A project: its state is Linear's (backlog, planned, started, paused, …).
export type Project = {
  id: string
  name: string
  state: string
  progress: number
  targetDate: string | null
  lead: string | null
  url: string
}

export type ProjectsLoaded = { projects: Project[]; error: string | null; isLoading: boolean }

// The project open on its own screen, its issues listed.
export type Scope = { id: string; name: string }

// A workspace signed in to, by its URL key, without its tokens.
export type Workspace = { key: string; name: string }

// Where the pane is: the list, one issue (picking a status for it), or
// signing in to a workspace.
export type View = { screen: 'list' } | { screen: 'issue'; id: string; picking: boolean } | { screen: 'signin' }

// A sign-in under way: what Linear is to send back, and the link to approve.
export type SignIn = { state: string; verifier: string; url: string; error: string | null; isBusy: boolean }

export type Loaded = { issues: Issue[]; at: number; error: string | null; isLoading: boolean }

export type Notice = { text: string; link: string | null; isError: boolean }

declare module 'claude-code' {
  interface PluginState {
    linear: {
      view: Shaped<View>
      workspace: string | null
      workspaces: Shaped<Workspace[]>
      signin: Shaped<SignIn | null>
      loaded: Shaped<Record<string, Loaded>>
      details: Shaped<Record<string, Detail>>
      statuses: Shaped<Record<string, Status[]>>
      filter: string
      // The row the keyboard is on, which the list is drawn around.
      selected: number
      tab: 'issues' | 'projects'
      projects: Shaped<Record<string, ProjectsLoaded>>
      scope: Shaped<Scope | null>
      notice: Shaped<Notice | null>
      // The mod's command the pane was opened from, to go back to with Esc.
      from: string | null
    }
  }
}

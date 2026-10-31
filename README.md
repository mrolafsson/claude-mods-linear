# claude-mods-linear

**Your Linear issues and projects in a pane beside Claude Code.** Read an
issue, change its status, copy its branch, and start it as a Claude Code
cloud session, without leaving the conversation.

A Claude Code mod: a plugin that draws in Claude Code's own interface. It
works in a terminal session and in the desktop app's Code tab.

- **Your open issues**, grouped by status (In Review and In Progress first),
  in Linear's own marks and colours, urgent ones marked.
- **Type to filter.** The cursor stays in the filter: ↑ and ↓ move the
  highlight, Enter opens the issue, Esc clears the filter, then closes.
- **Projects**, grouped by state, with progress, lead and target date. A
  project opens on its own screen with its open issues.
- **An issue's screen**, laid out as herdr-linear's: status in Linear's colour, priority, project, assignee, labels in their colours, cycle, due
  date, branch and the description, with its actions in colour:
  - **start in cloud** makes the issue yours and In Progress, and starts a
    Claude Code cloud session on it, told to branch from `origin/main` and
    open a draft pull request. The pane shows the session's link.
  - **status** moves it to any state in your team's workflow.
  - **copy branch** copies Linear's branch name for it.
  - **open in Linear**.
- **Several workspaces**: sign in to each, switch at the top.
- **As big as the layout allows**: beside the conversation with
  `/tui fullscreen` (up to 45% of the width), above the prompt with
  `/tui default`.

## Install

At the prompt of a Claude Code session:

```
/plugin install linear --marketplace mrolafsson/claude-mods-linear
```

Answer `y` to add the marketplace, then pick a scope (user, for every
session). Or from a shell:

```sh
claude plugin install linear --marketplace mrolafsson/claude-mods-linear
```

In the desktop app: click **+** next to the prompt box, then **Plugins**,
**Add marketplace** with `mrolafsson/claude-mods-linear`, then **Add plugin**.

## Use

Type `/linear`. The first time, it asks you to sign in:

1. Open the link (or copy it to a browser anywhere) and approve access in
   Linear, choosing the workspace.
2. Linear then sends the browser to a `localhost:47821` page, which may not
   load, say when Claude runs on another computer over SSH. Copy that page's
   whole address, Tab to the box in the pane, paste it and press Enter.

| Key | Does |
| --- | --- |
| type | filter |
| ↑ ↓ | move the highlight; ↑ from the first row reaches the tabs |
| ↑ on the tabs, Enter | choose Issues or Projects, open it |
| Enter | open the highlighted issue or project |
| Esc | clear the filter; back from an issue or a project; close |
| s, c, y, b | on an issue: start in cloud, status, copy branch, back |

**Start** runs the cloud session from the repository the Claude session is in,
so open the pane from a session in the issue's repository. `claude --cloud`
takes your local branch with it, so the session is told to start from
GitHub's `origin/main`.

## Privacy and security

- Signs in with Linear's OAuth (PKCE, no client secret), as
  [herdr-linear](https://github.com/mrolafsson/herdr-linear) does, with its
  public client ID. Access is `read,write`, and can be revoked in Linear's
  settings.
- The tokens are kept in Claude Code's plugin store on that computer
  (`~/.claude/plugins/store/`), a file only you can read. **sign out** in the
  pane forgets a workspace there.
- The mod talks to `api.linear.app` and `linear.app` alone, and runs
  `claude --cloud` (through `script`, which gives it the terminal it needs)
  only when you press **start in cloud**.

## License

MIT

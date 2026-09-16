# GitHub

One extension, five palettes, one sign-in: your pull requests, issues,
repositories and notifications as rows, and GitHub's own search typed
into the panel. Enter opens the thing on GitHub; the other actions copy,
check out, merge, close or mark read without leaving the keyboard.

| palette | id | kind | what `Enter` does |
| --- | --- | --- | --- |
| Pull Requests | `github-prs` | indexed, 5 min | opens the pull request |
| Issues | `github-issues` | indexed, 5 min | opens the issue |
| Repositories | `github-repos` | indexed, 5 min | opens the repository on GitHub |
| Notifications | `github-notifications` | live, 1 min | marks the thread read and opens it |
| Search GitHub | `github-search` | input | opens what was found |

**Pull Requests** lists yours (`is:open author:@me`), the ones waiting on
your review (`review-requested:@me`), and yours merged within
`merged_days`, sectioned Mine, Review requested, Merged; the filter
dropdown has the same three plus All. The row is the title with
`owner/repo #n` under it, a state dot (green open, grey draft, violet
merged, red closed) and tags for the checks (`checks ✓` / `✗` / `…`),
the review decision (approved, changes requested, review), draft and
conflicts, then the updated date. The palette opens with the detail pane:
the body, the latest comments and reviews, and under them the repository,
author, branch, size, every check by name, who approved, who asked for
changes, reviewers, labels and dates (fetched when the cursor rests).

**Issues** is what is assigned to you, mentions you, or you opened, in
that order, an issue in two lists listed once. Rows carry the first two
labels, the comment count and the updated date; the pane the body, the
latest comments and the milestone. **Create Issue** at the top is a form
(repository, title, body) whose submit opens the new issue.

**Repositories** is yours (owner or collaborator, by push date), your
`default_org`'s recently pushed, and your starred ones, sectioned so. Rows
show the description, tags for private, archived and the language, the
stars and the push date; the pane adds forks, open issues, the default
branch, the clone url and the local clone when one sits under
`repos_root`. **Create Repository** is a form (owner, name, description,
private).

**Notifications** is every unread thread, sectioned by reason (Review
requested, Mentioned, Assigned, Your threads, Comments, State changed, CI,
Security, Subscribed), newest first inside one; the first row is the
unread count. Enter marks the thread read and opens it, so the count is
honest when you come back.

**Search GitHub** takes GitHub's syntax as you type: free text,
`repo:owner/name`, `is:pr`, `author:login`, `label:bug`. Filters
Everything, Issues and PRs, Repositories, Users; results come sectioned by
kind with the same rows and actions as the palettes above, users with
their avatar. A keystroke waits 300 ms for the next before asking.

## Keyboard

| keys | action | where |
| --- | --- | --- |
| `enter` | Open (Open on GitHub, Open profile) | everywhere; a notification is marked read first |
| `cmd+c` | Copy URL (Copy login on a user) | everywhere |
| `cmd+shift+o` | Checkout branch: `gh pr checkout` in the clone | an open pull request with a clone under `repos_root` and `gh` on PATH |
| `cmd+shift+b` | Copy branch name | pull requests |
| `cmd+shift+k` | Open checks | pull requests |
| `cmd+shift+f` | Open files changed | pull requests |
| `cmd+shift+r` | Mark ready for review | a draft pull request |
| `cmd+shift+m` | Merge, with `merge_method`; asks first | an open, mergeable pull request |
| `cmd+shift+x` | Close issue; asks first | an open issue |
| `cmd+e` | Open in editor (`code`, else the folder) | a repository with a local clone |
| `cmd+o` | Open folder | a repository with a local clone |
| `cmd+shift+c` | Copy clone URL (`clone_protocol`) | repositories |
| `cmd+shift+r` | Mark as read, without opening | notifications |
| `cmd+shift+a` | Mark all as read; asks first | notifications |
| `cmd+k` | Copy reference (`owner/repo#n`), Copy owner/name, Open issues, Open pull requests, Open repositories | the rest, without a shortcut |
| `cmd+i` | The detail pane (open by default in Pull Requests and Issues) | |

## Setup

Sign in one of two ways: install the [gh CLI](https://cli.github.com) and
run `gh auth login` (the extension asks `gh auth token` at most every five
minutes), or set the `token` setting to a personal access token with
`repo`, `notifications` and `read:org` (the config file holds a
`keychain:` reference, never the value). With neither, each palette is one
hint row saying how to sign in; Enter on it opens the token settings. A
token GitHub rejects is the same row with GitHub's message.

Every request has a 10 s timeout. Pull Requests, Issues and Search are one
GraphQL request each; Repositories and Notifications are REST with ETags,
so a re-list that changed nothing costs no rate limit. The rows are kept
in the extension's storage, so a restart still has them and an outage
shows the last ones; while the rate limit is exhausted a hint row at the
top says when it resets.

Settings, `[extensions.github]`:

| key | type | default | what |
| --- | --- | --- | --- |
| `token` | secret | (none) | A personal access token; empty means the gh CLI's login. |
| `default_org` | text | (none) | The organisation whose recently pushed repositories are listed, and an owner the Create Repository form offers. |
| `repos_root` | path | (none) | Where your clones live (`<root>/<name>` or `<root>/<owner>/<name>`); enables Checkout branch and Open in editor. `~` is expanded. |
| `clone_protocol` | `ssh` / `https` | `ssh` | What Copy clone URL copies. |
| `merged_days` | number (days) | `7` | How far back the Merged list reaches. |
| `merge_method` | `merge` / `squash` / `rebase` | `merge` | How the Merge action merges. |

The bar item **Notifications** shows the unread count as a badge (hidden at
zero) with the newest five and Mark all read in its popover, refreshed
every five minutes and on show, wake and a network change.

## What it does not do

- Review from the panel: approving, commenting and requesting changes
  happen on GitHub; the pane only shows them.
- Repositories beyond yours, your organisation's recent ones and your
  stars: anything else is found through Search.
- Notifications older than what GitHub returns as unread; read ones are
  not listed.
- Checkout without a clone: Checkout branch needs the repository already
  cloned under `repos_root` and `gh` on PATH.

## Platforms

macOS and Linux, the same on both. Open in editor uses `code` when it is
on PATH, else the system opener on the folder.

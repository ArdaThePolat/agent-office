# Agent Office

A small macOS window that shows your Claude Code agents at work, as a pixel-art office.

![Agent Office: three PR reviews at their desks and three in the queue on the sofa; below, Claude Code sessions with their subagents, each with its state, model and effort](docs/screenshot.png)

*Demo data. Open `web/office.html` in a browser to see it live.*

See at a glance which session is **waiting for you**, which is working, which has finished, and what
its subagents are doing, without switching between terminals.

## Quick start

Needs macOS 13+, the Xcode command-line tools, `jq` and Claude Code.

```bash
git clone https://github.com/ArdaThePolat/agent-office.git
cd agent-office
scripts/build-app.sh                 # builds ~/Applications/Agent Office.app
scripts/install-hook.sh --dry-run    # shows the change to ~/.claude/settings.json
scripts/install-hook.sh              # registers the hook (keeps your existing hooks)
open ~/Applications/"Agent Office.app"
```

Sessions report from their next turn on; start a new Claude Code session (or send a message in an
open one) and it walks into the office.

### Or let your agent set it up

Run this in a terminal; Claude Code clones the repo and installs it, step by step:

```bash
claude "Clone https://github.com/ArdaThePolat/agent-office into ~/agent-office, then install Agent Office by following its AGENTS.md exactly. Show me the change to my Claude settings and ask me before applying it."
```

Using another coding agent? Paste the same sentence into it. [`AGENTS.md`](AGENTS.md) has the
steps with a check after each one, and the agent asks you before it touches your Claude settings
or your config.

Missing a prerequisite: `xcode-select --install` for the command-line tools, `brew install jq`.

## What you see

- **Others room**: every Claude Code session as a person at a desk, with its subagents at smaller
  desks below. Sessions in the same repo share a shirt and rug colour. They walk in through the
  door when a session starts and out when it ends. Under each one: its title, folder and state, and
  the model and effort of its latest reply (e.g. *Opus 5.5 · xhigh*).
- **Bubbles** say what each one needs:

  | bubble | means |
  |---|---|
  | **!** orange, blinking | waiting for your permission |
  | **✓** | done, your turn (for 30 minutes after its turn ends) |
  | **×** | stopped with an error |
  | **hourglass** | its turn is over but subagents it started in the background are still running |
  | **…** | compacting its context |
  | **?** | quiet: working, but silent for over 10 minutes |
  | **z** | idle |

- **Review room** (optional): one desk per PR-review slot with repo, PR, owner and how long it has
  been running, and a sofa for the queue. See *Configuration*.
- **Log strip**: general events only (session waiting for you, done, subagent started / finished,
  review started / posted).

Hover an agent for details. Click a session to reveal its folder in Finder, or a review desk to open
the PR. **Right-click an agent → Hide from view** to take it out of the office until something new
happens to it (you send it a message, it asks for a permission, its turn ends, it errors); then it
walks back in. Right-click anywhere → **Show hidden agents** brings them all back.

## Settings

Agent Office → Settings… (⌘,), all off by default:
- **Keep on top**: float the window above other apps and across Spaces.
- **Play a sound**: "Glass" when an agent waits for your permission, "Pop" when one finishes.
- **Energy saver**: 2 redraws a second instead of 6, no walking or blinking.

The window remembers its size and position. **Check Setup…** in the same menu says whether the
hook is registered for every event and when a session last reported.

## Configuration

Optional: `~/.config/agent-office/config.json`. Everything specific to your setup lives in this
file, not in the repository. Every key is optional.

```json
{ "officeState": "~/.local/state/agent-office",
  "reviews": { "state": "~/.local/state/pr-watch", "log": "~/Library/Logs/pr-watch.log",
               "slots": 5, "bitbucketWorkspace": "<workspace>" },
  "sessionKinds": [
    { "startsWith": "You are running the automated PR review", "kind": "review",
      "repoAfter": "for the repo '", "title": "PR review: {repo}" },
    { "startsWith": "You maintain the list of known defects", "kind": "automation",
      "repoAfter": "for the repo '", "title": "clean-reports: {repo}" } ] }
```

- **`reviews`** feeds the review room from a PR reviewer that keeps:
  - `<state>/running/<repo>-<pr>`: one tab-separated line per review in progress (repo name, repo
    slug, PR number, commit, author, start time `HH:MM`, pid, title);
  - `<state>/queue`: one line per waiting PR (repo name, slug, number, commit, author,
    `auto`/`manual`, title);
  - a log whose lines look like `YYYY-MM-DD HH:MM:SS [pr-watch] <repo>#<pr>: …`.

  `bitbucketWorkspace` makes a review desk link to its Bitbucket PR. Without a `reviews` block the
  review room stays empty.
- **`sessionKinds`** tells headless jobs apart from your own sessions by how their first prompt
  starts.
  - `kind` is `review` (drawn at a review desk) or `automation` (⚙ in the others room).
  - `repoAfter`, and `repoEnd` (default `'`), cut a repo name out of the prompt for `{repo}` in
    `title`.
  - Sessions that match no entry are your own, titled from the Claude app or their folder.

## How it works

```
Claude Code ──hook──▶ ~/.local/state/agent-office/sessions/<id>.json  ─┐
                       ~/.local/state/agent-office/events.log           ├─▶ Agent Office.app (reads every 2 s
PR reviewer ─────────▶ <reviews state>/running/*, queue, log file ─────┘    while its window is visible)
```

- **`hook/agent-office-hook.sh`** is a Claude Code hook.
  - It keeps one small JSON file per session: title, folder, state, subagents, model, effort, and
    the Claude process id.
  - It appends general events to a log.
  - It always exits 0, prints nothing, and on the frequent "tool finished" event returns after a
    single `grep`.
- **`app/AgentOffice.swift`** is the window: a WKWebView around `web/office.html`.
  - It drops a session whose Claude process is gone, so a crashed session never lingers.
  - There is no server and no port, and nothing runs while the window is closed.
- **`web/office.html`** is the office, drawn in code. Opened in a browser on its own, it shows demo
  data.

## Privacy and cost

- **What is recorded:** states only. No prompt text, tool names or arguments are recorded. The first
  prompt is read only to match `sessionKinds`, and the transcript only for the latest model and
  effort. Everything stays on your Mac, under `~/.local/state/agent-office/`.
- **CPU and memory:** the app runs at background priority and reads its state only while its window
  is visible. It redraws at most 6 times a second (none while hidden) and draws at most 30 sessions;
  walls, floors and furniture are painted once and cached. Measured on an M-series Mac with the
  window visible: about 4% of one core and about 55 MB of memory.

## Uninstall

```bash
scripts/install-hook.sh --uninstall           # removes exactly the hook entries it added
rm -rf ~/Applications/"Agent Office.app"
rm -rf ~/.local/state/agent-office            # session files and the event log
```

## Debugging

- `"$HOME/Applications/Agent Office.app/Contents/MacOS/AgentOffice" --dump-snapshot` prints exactly
  what the window is given.
- `ls ~/.local/state/agent-office/sessions/` should hold one file per running session; if it is
  empty, check **Check Setup…** and that `jq` is installed (the hook needs it).
- Open `web/office.html` in a browser to see the demo.

## License

[MIT](LICENSE)

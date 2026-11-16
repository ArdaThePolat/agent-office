# Agent Office

A small macOS window that shows your AI agents at work, as a pixel-art office.

![Agent Office: three PR reviews at their desks and three in the queue on the sofa; below, Claude Code sessions with their subagents, each with its state, model and effort](docs/screenshot.png)

*The demo data (open `web/office.html` in a browser to see it live).*

- **Review room**: one desk per PR-review slot, showing repo, PR, owner and how long it has been
  running, plus a waiting bench for the queue. It reads a pr-watch-style state folder (see Configuration).
- **Others room**: every Claude Code session as a head agent at a desk, its subagents as smaller
  workers at their own desks below it. Agents of the same repo share a shirt colour; they walk in
  through the door when a session starts and out when it ends, and blink now and then. A bubble
  says what each one needs: **!** waiting for your permission (orange, blinking), **✓** done,
  your turn (for 30 minutes after its turn ends), **×** stopped with an error, **…** compacting,
  **?** quiet (working but silent for over 10 minutes), **z** idle, and an **hourglass** when its turn has ended but subagents it started in the background are still running (they stay at their desks until each one finishes). The room's header counts
  *needs you · working · done*.
- **Log strip**: general events only (review started / posted / safe to merge, session waiting
  for you, subagent started / finished). No tool names or arguments are recorded.

Under each session: its title, its folder and state, and the model and effort of its latest reply (e.g. *Opus 5.5 · xhigh*, read from the session's transcript when a turn starts or ends). Hover an agent for details; click a review desk to open the PR, or a session to reveal its folder.
**Right-click an agent → Hide from view** to take it out of the office. It stays hidden only while
nothing new happens to it: the moment its state changes (you send it a message, it asks for a
permission, its turn ends, it errors) it walks back in. Subagents coming and going do not count. A
hidden session that ends is forgotten; right-click anywhere → **Show hidden agents** brings them
all back. The list is kept in the app's preferences, so it survives a restart.

The office is drawn as rooms: walls with windows whose sky follows the time of day (day, dusk,
night), a wall clock showing the real time, a carpeted review room with a sofa for the queue and a
coffee machine, and a wood-floored room for everyone else where each team (repo) works on a rug in
its colour. The walls, floors and furniture are painted once into a cached layer and repainted
only when the layout or the minute changes.

## How it works

```
Claude Code ──hook──▶ ~/.local/state/agent-office/sessions/<id>.json  ─┐
                       ~/.local/state/agent-office/events.log           ├─▶ Agent Office.app (reads every 2 s
PR reviewer ─────────▶ <reviews state>/running/*, queue, log file ─────┘    while its window is open)
```

- `hook/agent-office-hook.sh`: a Claude Code hook. It keeps one small JSON file per session
  (title, folder, state, subagents, the Claude process id) and appends general events. It always
  exits 0, prints nothing, and returns after a single `grep` on the frequent "tool finished" event.
- `app/AgentOffice.swift`: the window, a WKWebView around `web/office.html`. It drops a session
  whose Claude process is gone, so a crashed session never lingers. There is no server and no port,
  and nothing runs while the window is closed.
- `web/office.html`: the office, drawn in code. Opened in a browser on its own, it shows demo data.

## Install

Needs macOS 13+ and the Xcode command-line tools.

```bash
scripts/build-app.sh                 # builds ~/Applications/Agent Office.app
scripts/install-hook.sh --dry-run    # shows the change to ~/.claude/settings.json
scripts/install-hook.sh              # registers the hook (keeps your existing hooks)
```

`scripts/install-hook.sh --uninstall` removes exactly what it added. Sessions started after the
hook is installed appear in the office.

## Settings

Agent Office → Settings… (⌘,), all off by default:
- **Keep on top**: float the window above other apps and across Spaces.
- **Play a sound**: "Glass" when an agent waits for your permission, "Pop" when one finishes.
- **Energy saver**: 2 redraws a second instead of 6, no walking or blinking.

The window remembers its size and position. **Check Setup…** in the same menu says whether the
hook is registered for every event and when a session last reported.

## Cost

The app runs at background priority, reads its state only while the window is actually visible
(not minimised, hidden or covered), and redraws at most 6 times a second (never while hidden);
at most 30 sessions are drawn. Measured on an M-series Mac with the window visible: about 4% of
one core in total (app plus its web view) and about 55 MB of memory; nothing while hidden.
The hook records no prompt text: a session without a title from the app is named after its folder.
- `~/.config/agent-office/config.json` (every key optional):

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

  Without a `reviews` block the review room stays empty. Everything specific to your setup (your
  folders, your review tool's paths and workspace, how your headless jobs' prompts start) lives in
  this file, not in the repository.

  `sessionKinds` tells headless jobs apart from your own sessions by the start of their first
  prompt: `kind` is `review` (drawn at a review desk) or `automation` (⚙ in the others room);
  `repoAfter` (and `repoEnd`, default `'`) cut a repo name out of the prompt for `{repo}` in
  `title`. Sessions that match no entry are your own sessions, titled from the app or their folder.

## Debugging

- `"~/Applications/Agent Office.app/Contents/MacOS/AgentOffice" --dump-snapshot` prints exactly
  what the window is given.
- Open `web/office.html` in a browser to see the demo.

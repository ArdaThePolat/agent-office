@AGENTS.md

## Changing the app: test in the dev app

AGENTS.md above is for installing Agent Office. When you change the app instead, try every change in
the dev app, never in the installed one:

- Build and open it with `scripts/build-app.sh --dev`, then `open ~/Applications/"Agent Office Dev.app"`.
  It has its own bundle id, settings, macOS permissions and config folder (`~/.config/agent-office-dev`),
  and never updates itself, so the person's own app, room, name and settings are untouched. It reads
  the same sessions, so the office shows their real agents.
- Do not run `scripts/build-app.sh` without `--dev` to test. It replaces `~/Applications/Agent Office.app`,
  the app the person is using: a broken build there breaks their office, and on a room's host Mac
  their team's room. Building the real app is for installing and updating only.
- To check only that it compiles, build into a scratch folder: `scripts/build-app.sh --dev <folder>`.
- For shared features (the room, chat, mini-games), join the person's room from the dev app as a
  second person.

## Testing the terminal

The terminal (`app/Terminal.swift`, `web/terminal.html`) has tabs, each its own login shell, and sits
on the side chosen in View → Terminal Position.
- Drive it through the View menu (Terminal, New Terminal Tab, Next / Previous Terminal Tab,
  Terminal Position) and Window → Close: those reach the app from the background. A click sent to
  a background window does not reach the web view, so test the tab bar's clicks (+, ×, a tab) by
  serving `web/terminal.html` with a stub for `window.webkit.messageHandlers.term`, or ask the
  person to click.
- After closing a tab, check its shell is gone: the dev app's child processes should hold one
  shell per open tab and no zombie.
- Each side saves its divider in the dev app's defaults (`local.agent-office.dev`,
  `NSSplitView Subview Frames AgentOfficeTerminal…`); delete that key to see a side's first showing.

## Making a release

- **Pick the number from the releases, not from memory.** Right before `gh release create`, run
  `gh release list --limit 20` and take the next number above the **highest version** there,
  compared as numbers (`v0.10.2` is above `v0.9.3`), not the newest by date. Another session may
  have released minutes ago. A number below the highest is never offered by the in-app updater
  (it compares versions), and one equal to an existing tag fails.
- **One tag per commit.** The build stamps its version with `git describe --tags`; two release tags
  on one commit can stamp the older one, and the updater then offers the same update forever. No
  new commit on `main` since the last release means there is nothing to release.
- **Before tagging:** pull `main`, build it (`scripts/build-app.sh --dev <scratch folder>`), run
  `scripts/check-public.sh`, and try what changed (the page in a browser, the dev app). After:
  `git describe --tags --abbrev=0 origin/main` prints the new tag.
- **Notes:** everything since the previous release, each merged PR as `(#n)`, contributors
  credited. A change people must act on (a teammate's app needing the new version, a host that
  must update first) is said in the notes.
- **Docs travel with the change:** README, AGENTS.md (what the person sets up) and this file (how to
  work on the app) are updated in the PR that changes the behaviour, so a release never needs a
  separate docs pass.

## Testing the room

`app/Room.swift` builds on its own with a small `main.swift` beside it
(`swiftc -o t main.swift Room.swift`), so the room can be tested without the app: start a
`RoomHost` on a spare port and a `RoomClient` with `address: "127.0.0.1:<port>"` and
`discover = false`, run `RunLoop.main` while waiting, and stop and start the host to see a member
come back. The host's leaderboard file can be tested the same way, by setting `scoresFile` to a test
file and reading it back after two seconds.

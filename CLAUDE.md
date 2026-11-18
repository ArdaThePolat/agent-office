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

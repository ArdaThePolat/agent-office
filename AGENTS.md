# Installing Agent Office (instructions for a coding agent)

You are helping someone install Agent Office on their Mac. Follow these steps in order. Each
step says how to check it worked. Two steps change things outside this folder; ask the person
before each of them, as marked.

## 0. Check the machine

```bash
sw_vers -productVersion          # needs 13 or later
xcode-select -p                  # needs a path; if it fails, the person runs: xcode-select --install
command -v jq                    # needs a path; if missing: brew install jq
command -v claude                # Claude Code must be installed
```

If `xcode-select -p` fails, stop and ask the person to run `xcode-select --install` themselves
(it opens a system dialog). Do not try to install Xcode tools another way.

## 1. Build the app

```bash
scripts/build-app.sh
```

It compiles `app/AgentOffice.swift`, bundles `web/office.html` and installs
`~/Applications/Agent Office.app` (ad-hoc signed, so it runs on this Mac only). Check:
`ls ~/Applications/"Agent Office.app"`.

## 2. Register the hook (ASK FIRST)

The hook is how sessions report to the office. Installing it edits the person's Claude Code user
settings, `~/.claude/settings.json`. Show them the change, then ask before applying it:

```bash
scripts/install-hook.sh --dry-run    # prints the diff; show it to the person
scripts/install-hook.sh              # only after they agree
```

It adds one command hook per event and leaves every existing hook alone. It keeps a backup at
`~/.claude/settings.json.agent-office-backup`. Never edit `settings.json` by hand for this.

## 3. Open it and verify

```bash
open ~/Applications/"Agent Office.app"
```

Sessions that started **before** the hook was installed do not report; tell the person to start
a new Claude Code session (or send a message in an existing one: its next turn reports). Then:

```bash
ls ~/.local/state/agent-office/sessions/      # one <session-id>.json per running session
"$HOME/Applications/Agent Office.app/Contents/MacOS/AgentOffice" --dump-snapshot | head -c 600
```

In the app, **Agent Office → Check Setup…** says whether every hook event is registered and when
a session last reported.

## 4. Optional: a PR-review room (ASK FIRST)

The review room shows headless PR reviews only if the person runs a reviewer that writes a
`running/` folder, a `queue` file and a log (see the README, *Configuration*). If they do not,
skip this step: the room just stays empty. If they do, write `~/.config/agent-office/config.json`
with their paths. That file belongs to the person and stays out of this repository; ask before
creating or changing it, and never add their values to the repo.

## 5. Optional: the companion mod (ASK FIRST)

It adds context gauges, cost, plan usage and exact subagent states, and a one-line office status
under the prompt. It is a Claude Code plugin, so installing it changes the person's Claude Code
setup: ask first. Needs Claude Code 2.1.287+ (`claude --version`).

```bash
claude plugin install agent-office --marketplace ArdaThePolat/agent-office
```

Check: after the person's next turn in any session, `ls ~/.local/state/agent-office/live/` holds a
file for it, and **Stats** in the app shows its context and cost.

## Uninstall

```bash
scripts/install-hook.sh --uninstall           # removes exactly the entries it added
claude plugin uninstall agent-office          # the companion mod, if installed
rm -rf ~/Applications/"Agent Office.app"      # ask first
rm -rf ~/.local/state/agent-office            # ask first: the session files and event log
```

## Rules

- Do not change `hook/agent-office-hook.sh` to record prompts, tool names or arguments. The
  office shows states only, by design.
- Do not commit anything from `~/.config/agent-office/` or `~/.local/state/agent-office/`.
- The hook must stay fast and silent: it always exits 0 and prints nothing, or it would slow down
  or break the person's sessions.

## Changing this repository

This repository is public. Everything specific to one person or one machine lives outside it:
settings in `~/.config/agent-office/config.json`, state under `~/.local/state/agent-office/`, and
files such as a manager picture under `local/`, which git ignores. When you change the code,
docs or screenshots:

- **No personal values in the repo.** No real names other than the project owner's (LICENSE,
  plugin manifests, GitHub URLs), no email addresses, usernames, home paths (`/Users/<name>`),
  company, team, workspace or repository names, hostnames, session ids or PR numbers from
  someone's real work.
- **No secrets.** No tokens, API keys, passwords, cookies or private keys, not even in a test or
  a comment. The app and the hook need none.
- **A setting that differs per person goes in `config.json`**, with a neutral example in the
  README (`<workspace>`, `~/agent-office/...`) and a default that works without it. Never
  hard-code the value you found on the machine you are working on.
- **Demo data and screenshots are invented.** Use the demo in `web/office.html` (`/Users/me/...`,
  first names with an initial, made-up repos like `web-app` and `infra`) and render screenshots
  from it, never from someone's real office. Never commit a screenshot containing a real person's
  picture: the README screenshot uses the drawn manager.
- **Before every commit**, run `scripts/check-public.sh --staged`. It refuses home paths, emails,
  common token formats, anything under `local/`, and every value in the runner's own
  `config.json`. It cannot read images, so look at any image you add. If it flags something,
  move the value to `config.json` or replace it with an invented one; do not weaken the check
  to let it through.
- **Commits are authored with the GitHub noreply address**, not a personal email.

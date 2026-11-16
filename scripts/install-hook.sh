#!/bin/bash
#
# install-hook.sh [--dry-run | --uninstall] — register hook/agent-office-hook.sh in your Claude Code
# user settings (~/.claude/settings.json) for the events Agent Office needs, next to whatever hooks
# are already there (they are not touched). Running it twice changes nothing; --uninstall removes
# exactly these entries. A copy of the previous file is kept as settings.json.agent-office-backup.

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK="$ROOT/hook/agent-office-hook.sh"
SETTINGS="${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"
EVENTS='["SessionStart","UserPromptSubmit","PermissionRequest","Notification","PostToolUse","PreCompact","Stop","StopFailure","SubagentStart","SubagentStop","SessionEnd"]'
mode="${1:-install}"

[[ -f "$SETTINGS" ]] || echo '{}' > "$SETTINGS"
new="$(jq --arg hook "$HOOK" --argjson events "$EVENTS" --arg mode "$mode" '
  def strip: map(.hooks |= map(select(.command != $hook))) | map(select((.hooks | length) > 0));
  .hooks = (.hooks // {})
  | .hooks |= with_entries(.value |= strip) | .hooks |= with_entries(select((.value | length) > 0))
  | if $mode == "--uninstall" then .
    else reduce $events[] as $e (.; .hooks[$e] = ((.hooks[$e] // []) + [{hooks: [{type: "command", command: $hook}]}]))
    end' "$SETTINGS")"

if [[ "$mode" == "--dry-run" ]]; then
  diff <(jq . "$SETTINGS") <(printf '%s\n' "$new" | jq .) || true
  exit 0
fi
cp "$SETTINGS" "$SETTINGS.agent-office-backup"
printf '%s\n' "$new" | jq . > "$SETTINGS.tmp" && mv "$SETTINGS.tmp" "$SETTINGS"
chmod +x "$HOOK"
if [[ "$mode" == "--uninstall" ]]; then echo "Removed the Agent Office hook from $SETTINGS."
else echo "Agent Office hook registered in $SETTINGS (backup: $SETTINGS.agent-office-backup). New sessions report from now on."; fi

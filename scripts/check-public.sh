#!/bin/bash
# Fails if a tracked file (or, with --staged, a staged change) carries something that belongs to
# one person's machine instead of to the project: home paths, email addresses, keys and tokens,
# files under local/, and every value from the runner's own ~/.config/agent-office/config.json
# (their review paths, workspace, manager name and picture). Run it before every commit.
#
#   scripts/check-public.sh            # every tracked file
#   scripts/check-public.sh --staged   # what the next commit would add
set -u
cd "$(dirname "$0")/.." || exit 2

if [[ "${1:-}" == "--staged" ]]; then
  files="$(git diff --cached --name-only --diff-filter=ACMR)"
  content() { git show ":$1" 2>/dev/null; }
else
  files="$(git ls-files)"
  content() { cat "$1" 2>/dev/null; }
fi

fail=0
report() { echo "  $1: $2"; fail=1; }

# the project's own name and owner are meant to be public
allow='ArdaThePolat|Arda Polat|noreply@anthropic.com|users.noreply.github.com'

patterns=(
  '/Users/[A-Za-z0-9._-]+'                 # a home directory (demo data uses /Users/me)
  '/home/[A-Za-z0-9._-]+'
  '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'   # an email address
  '(AKIA|ASIA)[0-9A-Z]{16}'                # AWS access key
  'gh[pousr]_[A-Za-z0-9]{30,}'             # GitHub token
  'sk-[A-Za-z0-9_-]{20,}'                  # API keys of the sk- kind
  'xox[abpr]-[A-Za-z0-9-]{10,}'            # Slack token
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'
)

# the runner's own settings: none of these values may appear in the repository
personal=()
cfg="$HOME/.config/agent-office/config.json"
if [[ -f "$cfg" ]] && command -v jq >/dev/null; then
  while IFS= read -r v; do
    v="${v/#\~\//}"                        # ~/x and x match alike
    [[ ${#v} -ge 4 ]] && personal+=("$v")
  done < <(jq -r '.. | strings' "$cfg" | grep -vE '^(review|automation|for the repo .*)$|\{repo\}' | sort -u)
fi

while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  case "$f" in
    local/*) report "$f" "files under local/ are personal and must stay untracked"; continue ;;
    *.png|*.jpg|*.jpeg|*.webp|*.icns) continue ;;   # images: look at them before committing
  esac
  body="$(content "$f")"
  for p in "${patterns[@]}"; do
    hits="$(grep -noE -- "$p" <<<"$body" | grep -vE "$allow" | grep -vE '/Users/me\b' | head -3)"
    [[ -n "$hits" ]] && report "$f" "matches ${p}: $(tr '\n' ' ' <<<"$hits")"
  done
  # the project's own names are allowed even where a config value is part of them
  rest="$(sed -E "s/${allow}//g" <<<"$body")"
  for v in "${personal[@]+"${personal[@]}"}"; do
    grep -qF -- "$v" <<<"$rest" && report "$f" "contains \"$v\" from your config.json"
  done
done <<<"$files"

if [[ $fail -eq 0 ]]; then echo "check-public: clean"; else echo "check-public: fix the lines above (or move the value to config.json)"; fi
exit $fail

#!/bin/bash
#
# agent-office-hook.sh — the Claude Code hook that tells Agent Office what each session is doing.
#
# Registered for SessionStart, UserPromptSubmit, PermissionRequest, Notification, PostToolUse,
# PreCompact, Stop, StopFailure, SubagentStart, SubagentStop and SessionEnd (see README). It reads the hook's
# JSON on stdin and keeps one file per session in $AGENT_OFFICE_STATE/sessions/<session-id>.json:
#
#   {id, pid, kind, title, cwd, model, effort, state, since, updated, subagents: {<agent-id>: {type, since}}}
#
#   kind   session (a person's session) | review (a headless PR review: drawn in the review room)
#          | automation (another headless job); both come from "sessionKinds" in the config file
#   state  working (a turn is running) | waiting (it asked you for permission)
#          | done (its turn ended: your move) | crashed (the turn ended on an API error)
#          | background (its turn ended while subagents it started are still running)
#          | compacting (summarising its context) | idle (started, nothing asked yet)
#   pid    the Claude process the hook runs under; Agent Office drops a session whose pid is gone
#
# It also appends general events ("waiting for you", "subagent started") to $AGENT_OFFICE_STATE/events.log
# as <epoch>\t<session-id>\t<text>. No tool names, arguments or prompt text are recorded: the
# first prompt is read only to tell a headless review from a person's session, and a session
# without a title from the app is named after its folder.
# Every event also touches the session file, so its mtime is the session's heartbeat: Agent Office
# shows a session that has been "working" with no heartbeat for a while as stalled.
#
# A hook must never slow down or break the session it runs in: every step is best effort, the
# script always exits 0 and prints nothing, and the common case (a tool finished while not
# waiting) returns after one grep.

STATE="${AGENT_OFFICE_STATE:-$HOME/.local/state/agent-office}"
SESS="$STATE/sessions"
LOG="$STATE/events.log"
CONFIG="${AGENT_OFFICE_CONFIG:-$HOME/.config/agent-office/config.json}"
JQ="$(command -v jq || echo /opt/homebrew/bin/jq)"
mkdir -p "$SESS" 2>/dev/null || exit 0

input="$(cat)"
[[ -x "$JQ" && -n "$input" ]] || exit 0

# Fields joined by \x1f: unlike a tab it is not whitespace to `read`, so empty fields keep their place.
IFS=$'\x1f' read -r event sid cwd transcript prompt agent_id agent_type ntype source <<<"$(
  printf '%s' "$input" | "$JQ" -r '[
    .hook_event_name // "", .session_id // "", .cwd // "", .transcript_path // "",
    ((.prompt // "") | gsub("[\t\n\r\u001f]+"; " ") | .[0:200]),
    .agent_id // "", .agent_type // "", .notification_type // "", .source // ""
  ] | map(tostring) | join("\u001f")' 2>/dev/null)"
[[ -n "$event" && -n "$sid" ]] || exit 0
f="$SESS/$sid.json"
now="$(date +%s)"

# The common, frequent case first: a tool finished. It only changes the state when the session
# was not already working: waiting for a permission (the tool running means it was granted),
# compacting, or a turn that had ended and was picked up again without a prompt (background
# subagents reporting back). Otherwise it is a heartbeat.
if [[ "$event" == "PostToolUse" ]]; then
  grep -qE '"state": *"(waiting|compacting|crashed|done|idle)"' "$f" 2>/dev/null || { touch "$f" 2>/dev/null; exit 0; }
fi

note() { printf '%s\t%s\t%s\n' "$now" "$sid" "$1" >> "$LOG" 2>/dev/null; }

# The Claude process this hook belongs to: the nearest ancestor named claude.
claude_pid() {
  local p=$PPID line comm i
  for i in 1 2 3 4 5 6; do
    line="$(ps -o ppid=,comm= -p "$p" 2>/dev/null)" || return
    comm="${line#*[0-9] }"; comm="${comm##*/}"
    [[ "$comm" == "claude" ]] && { echo "$p"; return; }
    p="$(echo "$line" | awk '{print $1}')"
    [[ -z "$p" || "$p" -le 1 ]] && return
  done
}

# The title the app shows for the session: the transcript's latest custom title.
custom_title() {
  [[ -f "$transcript" ]] || return
  tail -c 4000000 "$transcript" 2>/dev/null | grep -o '"customTitle":"[^"]*"' | tail -1 | sed 's/^"customTitle":"//; s/"$//'
}

# The model and effort of the session's latest reply, as its transcript records them.
model_effort() {
  [[ -f "$transcript" ]] || return
  local tail; tail="$(tail -c 600000 "$transcript" 2>/dev/null)"
  # anchored on the transcript's own fields: a tool call's "model"/"effort" arguments
  # (a subagent asked for at another model) must not be read as the session's
  printf '%s\x1f%s' "$(grep -o '"model":"claude-[^"]*"' <<<"$tail" | tail -1 | sed 's/^"model":"//; s/"$//')" \
                    "$(grep -o '"effort":"[a-z]*","perTurnEffort"' <<<"$tail" | tail -1 | sed 's/^"effort":"//; s/",.*//')"
}

# Serialise updates to one session (a subagent's events can race its parent's).
lock="$f.lock"
for _ in $(seq 1 50); do mkdir "$lock" 2>/dev/null && break; sleep 0.02; done
trap 'rmdir "$lock" 2>/dev/null' EXIT

cur="{}"; [[ -s "$f" ]] && cur="$(cat "$f" 2>/dev/null || echo '{}')"
title_now="$(printf '%s' "$cur" | "$JQ" -r '.title // ""' 2>/dev/null)"
kind_now="$(printf '%s' "$cur" | "$JQ" -r '.kind // ""' 2>/dev/null)"

# kind and a fallback title come from the first prompt
kind="${kind_now:-session}"
title="$title_now"
# Headless jobs are told apart by how their prompt starts, as listed under "sessionKinds" in the
# config file (see README); nothing about any particular job lives in this script.
if [[ -n "$prompt" && -f "$CONFIG" ]]; then
  IFS=$'\x1f' read -r k t <<<"$("$JQ" -r --arg p "$prompt" '
    [(.sessionKinds // [])[] | (.startsWith // "") as $s | select($s != "" and ($p | startswith($s)))] | first // empty
    | (.repoAfter // "") as $after | (.repoEnd // "\u0027") as $end
    | (if $after != "" then (($p | split($after))[1] // "" | split($end)[0]) else "" end) as $repo
    | [(.kind // "automation"), ((.title // "{repo}") | gsub("\\{repo\\}"; $repo))] | join("\u001f")' "$CONFIG" 2>/dev/null)"
  [[ -n "$k" ]] && { kind="$k"; title="$t"; }
fi
if [[ "$kind" == "session" && ( "$event" == "SessionStart" || "$event" == "UserPromptSubmit" || "$event" == "Stop" ) ]]; then
  t="$(custom_title)"; [[ -n "$t" ]] && title="$t"
fi
if [[ -z "$title" && -n "$cwd" ]]; then title="${cwd##*/}"; fi
model=""; effort=""
if [[ "$event" == "SessionStart" || "$event" == "UserPromptSubmit" || "$event" == "Stop" ]]; then
  IFS=$'\x1f' read -r model effort <<<"$(model_effort)"
fi

state=""; text=""; sub_op=""
case "$event" in
  SessionStart)      if [[ "$source" == "compact" ]]; then state="working"
                     else state="idle"; [[ "$source" == "startup" || "$source" == "resume" ]] && text="session started"; fi ;;
  UserPromptSubmit)  state="working" ;;
  PermissionRequest) state="waiting"; text="waiting for you" ;;
  Notification)      [[ "$ntype" == "permission_prompt" ]] && { state="waiting"; text="waiting for you"; } ;;
  PostToolUse)       state="working"
                     # a subagent's own tool calls arrive here too; they keep a background session as it is
                     [[ -n "$agent_id" ]] && state="" ;;
  PreCompact)        state="compacting" ;;
  Stop)              state="done"; text="done, your turn" ;;   # "background" below if subagents still run
  StopFailure)       state="crashed"; text="stopped with an error" ;;
  SubagentStart)     sub_op="add"; text="└ subagent started: ${agent_type:-agent}" ;;
  SubagentStop)      sub_op="del"; text="└ subagent finished: ${agent_type:-agent}" ;;
  SessionEnd)        rm -f "$f"; [[ "$kind" == "session" ]] && note "session ended · ${title:-untitled}"; exit 0 ;;
  *)                 exit 0 ;;
esac

pid="$(printf '%s' "$cur" | "$JQ" -r '.pid // empty' 2>/dev/null)"
[[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null || pid="$(claude_pid)"

printf '%s' "$cur" | "$JQ" \
  --arg id "$sid" --arg pid "${pid:-0}" --arg kind "$kind" --arg title "$title" --arg cwd "$cwd" \
  --arg model "$model" --arg effort "$effort" \
  --arg state "$state" --argjson now "$now" --arg op "$sub_op" --arg aid "$agent_id" --arg atype "$agent_type" '
  .id = $id | .pid = ($pid | tonumber) | .kind = $kind | .title = $title
  | .cwd = (if $cwd != "" then $cwd else (.cwd // "") end)
  | (if $model != "" then .model = $model else . end)
  | (if $effort != "" then .effort = $effort else . end)
  | .subagents = (.subagents // {})
  | (if $state != "" and $state != .state then .state = $state | .since = $now else . end)
  | .since = (.since // $now) | .state = (.state // "idle")
  | (if $op == "add" and $aid != "" then .subagents[$aid] = {type: $atype, since: $now}
     elif $op == "del" and $aid != "" then del(.subagents[$aid]) else . end)
  # A turn that ends while subagents it started are still running (background agents) is not
  # done: it is waiting on them. When the last one finishes, the turn is over unless Claude picks
  # it up again (a tool call then makes it working).
  | (if .state == "done" and (.subagents | length) > 0 then .state = "background" else . end)
  | (if .state == "background" and (.subagents | length) == 0 then .state = "done" | .since = $now else . end)
  | (if $state == "idle" then .subagents = {} else . end)
  | .updated = $now' > "$f.tmp" 2>/dev/null && mv "$f.tmp" "$f"

# the event line follows where the session ended up, not only the event that arrived
final="$("$JQ" -r '"\(.state) \(.subagents | length)"' "$f" 2>/dev/null)"
case "$event:$final" in
  Stop:background*)   text="waiting on ${final#* } subagent(s)" ;;
  SubagentStop:done*) [[ "$(printf '%s' "$cur" | "$JQ" -r '.state // ""' 2>/dev/null)" == "background" ]] && note "done, your turn · ${title:-untitled}" ;;
esac
if [[ -n "$text" && "$kind" == "session" ]]; then note "$text · ${title:-untitled}"; fi

# keep the event log short
if [[ -f "$LOG" && $(wc -c < "$LOG") -gt 300000 ]]; then
  tail -n 400 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
fi
exit 0

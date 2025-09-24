#!/usr/bin/env bash
set -euo pipefail

# Safe-read the tool input without tripping set -u
INPUT_JSON="${CLAUDE_TOOL_INPUT-}"

# If Claude didn't populate the env var (can happen on some PostToolUse paths), exit quietly.
if [[ -z "${INPUT_JSON}" ]]; then
  # Non-blocking: nothing to do
  exit 0
fi

# Needs: jq
if ! command -v jq >/dev/null 2>&1; then
  echo "[hooks] jq not found; skipping."
  exit 0
fi

# Extract tool_name (best-effort)
tool_name="$(printf '%s' "$INPUT_JSON" | jq -r '.tool_name // empty')"

# Collect file paths depending on tool
declare -a paths
case "$tool_name" in
  Edit|Write)
    fp="$(printf '%s' "$INPUT_JSON" | jq -r '.tool_input.file_path // empty')"
    [[ -n "$fp" ]] && paths+=("$fp")
    ;;
  MultiEdit)
    while IFS= read -r p; do
      [[ -n "$p" ]] && paths+=("$p")
    done < <(printf '%s' "$INPUT_JSON" | jq -r '
      ( .tool_input.edits[]?.file_path,
        .tool_input.file_path,
        .tool_input.paths[]?
      ) // empty
    ' 2>/dev/null || true)
    ;;
  *)
    # Unknown tool; do nothing
    exit 0
    ;;
esac

# Filter to TS/TSX
declare -a file_paths
for p in "${paths[@]:-}"; do
  if [[ "$p" == *.js || "$p" == *.ts || "$p" == *.tsx ]]; then
    file_paths+=("$p")
  fi
done

# Nothing relevant to check
if [[ "${#file_paths[@]}" -eq 0 ]]; then
  exit 0
fi

echo "[hooks] Files changed:"
printf ' - %s\n' "${file_paths[@]}"

# run lint
  npm run lint
fi

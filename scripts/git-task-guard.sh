#!/usr/bin/env bash

set -u
set -o pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/git-task-guard.sh start
  scripts/git-task-guard.sh finish --mode auto [--require-main]
  scripts/git-task-guard.sh finish --mode manual
EOF
}

fail() {
  echo "Git Task Guard: FAIL"
  echo "Reason: $*"
  exit 1
}

repo_root=""
git_state_dir=""
state_file=""
baseline_dirty_file=""

require_repo() {
  repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || fail "current directory is not a git repository"

  local git_task_guard_path
  git_task_guard_path=$(git -C "$repo_root" rev-parse --git-path git-task-guard 2>/dev/null) || fail "cannot resolve the git state directory"
  if [[ "$git_task_guard_path" != /* ]]; then
    git_task_guard_path="$repo_root/$git_task_guard_path"
  fi

  git_state_dir="$git_task_guard_path"
  state_file="$git_state_dir/state"
  baseline_dirty_file="$git_state_dir/baseline-dirty-paths"
}

current_branch() {
  git -C "$repo_root" symbolic-ref --quiet --short HEAD 2>/dev/null || true
}

current_head() {
  git -C "$repo_root" rev-parse HEAD 2>/dev/null || true
}

remote_head_for_branch() {
  local branch="$1"
  git -C "$repo_root" rev-parse --verify "refs/remotes/origin/$branch^{commit}" 2>/dev/null || true
}

origin_main_head() {
  git -C "$repo_root" rev-parse --verify refs/remotes/origin/main^{commit} 2>/dev/null || true
}

dirty_paths() {
  git -C "$repo_root" status --porcelain=v1 --untracked-files=all \
    | cut -c4- \
    | LC_ALL=C sort -u
}

state_value() {
  local key="$1"
  awk -F= -v wanted="$key" '$1 == wanted { sub(/^[^=]*=/, ""); print; exit }' "$state_file"
}

check_branch_fork() {
  local branch="$1"
  local remote_head ahead behind

  remote_head=$(remote_head_for_branch "$branch")
  [[ -z "$remote_head" ]] && return 0

  ahead=$(git -C "$repo_root" rev-list --count "refs/remotes/origin/$branch..HEAD") || fail "cannot compare local branch with origin/$branch"
  behind=$(git -C "$repo_root" rev-list --count "HEAD..refs/remotes/origin/$branch") || fail "cannot compare local branch with origin/$branch"
  if [[ "$ahead" -gt 0 && "$behind" -gt 0 ]]; then
    fail "branch '$branch' and origin/$branch are diverged (local ahead $ahead, remote ahead $behind); handle manually"
  fi
}

start() {
  require_repo

  local branch head main_head temp_state temp_dirty
  branch=$(current_branch)
  [[ -n "$branch" ]] || fail "HEAD is detached; start requires a named branch"

  git -C "$repo_root" fetch origin || fail "git fetch origin failed"
  check_branch_fork "$branch"

  head=$(current_head)
  [[ -n "$head" ]] || fail "cannot resolve HEAD"
  main_head=$(origin_main_head)
  [[ -n "$main_head" ]] || main_head="MISSING"

  mkdir -p "$git_state_dir" || fail "cannot create git-only state directory"
  temp_state="$state_file.tmp.$$"
  temp_dirty="$baseline_dirty_file.tmp.$$"
  trap 'rm -f "$temp_state" "$temp_dirty"' EXIT

  dirty_paths > "$temp_dirty" || fail "cannot record dirty-file baseline"
  {
    echo "repo=$repo_root"
    echo "branch=$branch"
    echo "head=$head"
    echo "origin_main=$main_head"
  } > "$temp_state" || fail "cannot record git task baseline"
  mv "$temp_state" "$state_file" || fail "cannot save git task baseline"
  mv "$temp_dirty" "$baseline_dirty_file" || fail "cannot save dirty-file baseline"
  trap - EXIT

  echo "Git Task Guard: PASS"
  echo "Branch: $branch"
  echo "Local HEAD: $head"
  echo "Remote HEAD: $(remote_head_for_branch "$branch" | sed -n '1p')"
  echo "Pre-existing dirty preserved: $(if [[ -s "$baseline_dirty_file" ]]; then echo yes; else echo no; fi)"
}

finish() {
  local mode="$1"
  local require_main="$2"
  require_repo
  [[ -f "$state_file" && -f "$baseline_dirty_file" ]] || fail "no start baseline found; run start first"

  local branch baseline_repo baseline_branch baseline_head head remote_head main_head current_dirty new_dirty committed_paths touched_baseline
  branch=$(current_branch)
  [[ -n "$branch" ]] || fail "HEAD is detached"
  baseline_repo=$(state_value repo)
  [[ "$repo_root" == "$baseline_repo" ]] || fail "repository changed since start (was '$baseline_repo', now '$repo_root')"
  baseline_branch=$(state_value branch)
  [[ "$branch" == "$baseline_branch" ]] || fail "branch changed since start (was '$baseline_branch', now '$branch')"
  baseline_head=$(state_value head)
  [[ -n "$baseline_head" ]] || fail "start baseline has no HEAD"
  head=$(current_head)
  [[ -n "$head" ]] || fail "cannot resolve HEAD"

  git -C "$repo_root" merge-base --is-ancestor "$baseline_head" "$head" \
    || fail "current HEAD is not a descendant of the start HEAD"
  [[ "$baseline_head" != "$head" ]] || fail "no current-round commit exists after start"

  committed_paths=$(git -C "$repo_root" diff --name-only "$baseline_head" "$head" | LC_ALL=C sort -u)
  touched_baseline=$(comm -12 <(printf '%s\n' "$committed_paths" | LC_ALL=C sort -u) <(LC_ALL=C sort -u "$baseline_dirty_file"))
  [[ -z "$touched_baseline" ]] || fail "current-round commit touches pre-existing dirty path(s): $touched_baseline"

  current_dirty="$git_state_dir/current-dirty-paths.tmp.$$"
  dirty_paths > "$current_dirty" || fail "cannot inspect current dirty files"
  new_dirty=$(comm -13 <(LC_ALL=C sort -u "$baseline_dirty_file") <(LC_ALL=C sort -u "$current_dirty"))
  rm -f "$current_dirty"
  [[ -z "$new_dirty" ]] || fail "new dirty path(s) remain: $new_dirty"

  remote_head=$(remote_head_for_branch "$branch")
  [[ -n "$remote_head" ]] || fail "origin/$branch does not exist; push the current-round commit"
  git -C "$repo_root" merge-base --is-ancestor "$head" "$remote_head" \
    || fail "origin/$branch does not contain current HEAD; push the current-round commit"

  if [[ "$mode" == "manual" && "$branch" == "main" ]]; then
    fail "manual mode cannot finish on main"
  fi

  if [[ "$require_main" == "yes" ]]; then
    main_head=$(origin_main_head)
    [[ -n "$main_head" ]] || fail "origin/main does not exist"
    git -C "$repo_root" merge-base --is-ancestor "$head" "$main_head" \
      || fail "origin/main does not contain current HEAD"
  fi

  echo "Git Task Guard: PASS"
  echo "Branch: $branch"
  echo "Local HEAD: $head"
  echo "Remote HEAD: $remote_head"
  echo "Pre-existing dirty preserved: $(if [[ -s "$baseline_dirty_file" ]]; then echo yes; else echo no; fi)"
}

require_repo

if [[ "${1:-}" == "start" && "$#" -eq 1 ]]; then
  start
  exit 0
fi

if [[ "${1:-}" == "finish" ]]; then
  mode=""
  require_main="no"
  shift
  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --mode)
        [[ "$#" -ge 2 ]] || { usage; exit 2; }
        mode="$2"
        shift 2
        ;;
      --require-main)
        require_main="yes"
        shift
        ;;
      *)
        usage
        exit 2
        ;;
    esac
  done
  [[ "$mode" == "auto" || "$mode" == "manual" ]] || { usage; exit 2; }
  finish "$mode" "$require_main"
  exit 0
fi

usage
exit 2

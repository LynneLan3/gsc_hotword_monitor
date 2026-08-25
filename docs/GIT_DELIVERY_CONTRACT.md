# Shared Git Delivery Contract V1

This contract applies to every Hotword OS Goal that changes this repository.
The remote repository is the long-term trusted baseline. A local checkout must
never be the only copy of a valid result.

## Delivery modes

### AUTO_ACCEPT

- After the authorized tests/build pass, the completed work must be committed
  and pushed.
- A Goal is not DONE while its current-round result exists only as an
  uncommitted local change.
- If the Goal explicitly requires entering `main`, `origin/main` must contain
  the current-round commit.

### MANUAL_ACCEPT

- Completed work must still be committed.
- Push it to an independent feature or review branch.
- Do not merge `main` before human acceptance.
- If acceptance fails, continue fixing on that same remote branch.

## Shared rules

- Before work starts, run `git fetch origin` and record the repository, branch,
  HEAD, `origin/main`, and the current dirty-file baseline.
- Preserve pre-existing unrelated dirty changes. They are not a delivery
  result and must not be silently discarded or committed by the guard.
- Do not automatically reset or rebase an unexplained local/remote fork.
  Stop and ask for human handling when the branch is visibly diverged.
- A normal DONE state must not contain newly dirty files from the current
  round. Baseline dirty files may remain.
- Use the guard from the repository checkout:

```sh
/Users/lanling/Code/hot_words_websites/gsc_hotword_monitor/scripts/git-task-guard.sh start
```

The guard stores its baseline under `.git/` only. It does not create tracked
runtime state.

## Guard commands

```sh
scripts/git-task-guard.sh start
scripts/git-task-guard.sh finish --mode auto
scripts/git-task-guard.sh finish --mode auto --require-main
scripts/git-task-guard.sh finish --mode manual
```

`start` fetches `origin`, rejects an obvious ahead-and-behind branch fork, and
records the baseline. `finish` exits non-zero with an explicit reason unless
the current-round commit is present on the corresponding remote branch and no
new dirty paths remain. `--require-main` additionally requires
`origin/main` to contain the current HEAD. Manual mode additionally requires
the current branch not to be `main`.

Successful output stays short:

```text
Git Task Guard: PASS
Branch: <branch>
Local HEAD: <commit>
Remote HEAD: <commit>
Pre-existing dirty preserved: yes|no
```

## Promotion rule

When promoting a reusable infrastructure artifact from a feature branch to
main, prefer the final artifact state over preserving feature-branch commit
history.

If cherry-pick requires unrelated ancestors or causes dependency conflicts:

- start from clean latest `origin/main`
- copy only the final required artifacts
- create one independent promotion/squash commit
- do not merge unrelated feature history

## Future Goal prompt header

Use one of these fixed short forms in future prompts.

### AUTO

Delivery mode: AUTO_ACCEPT
Before work run:
/Users/lanling/Code/hot_words_websites/gsc_hotword_monitor/scripts/git-task-guard.sh start
Task is not DONE until:
/Users/lanling/Code/hot_words_websites/gsc_hotword_monitor/scripts/git-task-guard.sh finish --mode auto
passes.

### MANUAL

Delivery mode: MANUAL_ACCEPT
Before work run:
/Users/lanling/Code/hot_words_websites/gsc_hotword_monitor/scripts/git-task-guard.sh start
Push completed work to a remote review branch.
Task is not DONE until:
/Users/lanling/Code/hot_words_websites/gsc_hotword_monitor/scripts/git-task-guard.sh finish --mode manual
passes.

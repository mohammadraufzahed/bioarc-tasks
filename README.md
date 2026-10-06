# BioArc Tasks

Oh My Pi extension for managing tasks and creating BioArc-style task commits.
Tasks are stored in each repository's Git directory (`bioarc-tasks.json`), not
in the worktree. Deleting a task removes only its record; Git history is never
rewritten.

## Install

Install as a Git submodule at `.omp/extensions/bioarc-tasks` and add
`./.omp/extensions/bioarc-tasks/index.ts` to the project's `.omp/config.yml`
`extensions` list. Then restart Oh My Pi and run `/bioarc-task setup` to set the
single supervisor name. Re-run `setup` any time to change it; settings are
written to the ignored local file `.omp/bioarc-tasks.json`.

Run `/bioarc-task update` to pull the tracked submodule's configured branch.
Restart the session after updating so Oh My Pi loads the new extension version.

## Commands

- `/bioarc-task` offers autocomplete for actions and task IDs.
- `/bioarc-task create <title>` creates a task branch and isolated worktree from `origin/main`.
- `/bioarc-task sync <id>` merges latest `origin/main` into the task branch; conflicts leave the worktree for resolution.
- `/bioarc-task diff <id>` shows task changes relative to `origin/main`.
- `/bioarc-task commit [id]` syncs first, then commits staged task-worktree changes.
- `/bioarc-task integrate <id>` syncs, merges into the clean local `main`, and pushes only `main` to `origin`.
- `/bioarc-task cleanup <id>` removes a clean worktree; the local branch is deleted only if merged into `main`.
- `/bioarc-task list`, `/bioarc-task complete [id]`, `/bioarc-task delete [id]`, `/bioarc-task default [id|clear]`, `/bioarc-task setup [supervisor]`, `/bioarc-task update`.
The AI receives `bioarc_task_create`, `bioarc_task_list`, `bioarc_task_status`, `bioarc_task_sync`, `bioarc_task_diff`, `bioarc_task_commit`, `bioarc_task_integrate`, and `bioarc_task_cleanup` tools.

Task IDs are UUIDs; their first eight characters are shown and work as short IDs.
Defaults are persisted in session history and remain separate per session.
Commits include only staged changes and record the resulting hash. Stage only the
task's changes first. Subjects follow:

`نوع کامیت: تسک میزیتو عنوان تسک: <عنوان> فرد محول کننده: <سرپرست>`

Task worktrees live under the Git common directory at `bioarc-worktrees/<task UUID>`.
Configure `origin/main` before creating worktree tasks. Integration refuses a dirty
main worktree or a local `main` that differs from fetched `origin/main`; rejected
pushes never force-push.

## Structure

- `src/domain`: task invariants and commit subject.
- `src/application`: task and setup use cases.
- `src/ports.ts`: repository, Git, project config, and update contracts.
- `src/adapters`: Git execution, JSON persistence, and submodule update adapters.
- `index.ts`: Oh My Pi adapter and composition root.

The application service depends on the domain and ports; adapters implement
ports. `index.ts` wires them together, keeping Oh My Pi and Git/JSON concerns out
of the domain.

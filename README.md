# BioArc Tasks

Oh My Pi extension for task tracking and BioArc-style task commits.
Tasks are labels stored in the repository's shared Git directory. Selecting a task
does not create, switch, or remove branches or worktrees; commits affect the current
session checkout only. Deleting a task removes only its record; Git history is never rewritten.

## Install

Install as a Git submodule at `.omp/extensions/bioarc-tasks` and add
`./.omp/extensions/bioarc-tasks/index.ts` to the project's `.omp/config.yml`
`extensions` list. Then restart Oh My Pi and run `/bioarc-task setup` to set the
single supervisor name. Re-run `setup` any time to change it; settings are
written to the ignored local file `.omp/bioarc-tasks.json`.

Run `/bioarc-task update` to fast-forward the extension checkout from `origin/master`.
Restart the session after updating so Oh My Pi loads the new extension version.

## Commands

- `/bioarc-task` offers autocomplete for actions and task IDs.
- `/bioarc-task create <title>` creates a task record and selects it for the current session.
- `/bioarc-task list`
- `/bioarc-task worktree [id]` creates an isolated `bioarc-task/<id>` branch and worktree for an open task; defaults to the session-selected task. It prints the path; OMP does not switch the current session automatically.
- `/bioarc-task complete [id]`, `/bioarc-task delete [id]`, `/bioarc-task setup [supervisor]`, `/bioarc-task update`.
- The AI receives `bioarc_task_select`, `bioarc_task_create`, `bioarc_task_list`, `bioarc_task_commit`, and `bioarc_task_worktree` task tools.

Task IDs are UUIDs; their first eight characters are shown and work as short IDs.
Defaults are persisted in session history and remain separate per session.
Commits include only staged changes and record the resulting hash. Stage only the
task's changes first. Subjects follow:

`نوع کامیت: تسک میزیتو عنوان تسک: <عنوان> فرد محول کننده: <سرپرست>`

Task worktrees are sibling checkouts under `<repo>-worktrees/<id>` on a new `bioarc-task/<id>` branch. Creation returns the path; OMP's extension API does not switch the active session checkout.

## Structure

- `src/domain`: task invariants and commit subject.
- `src/application`: task and setup use cases.
- `src/ports.ts`: repository, Git, project config, and update contracts.
- `src/adapters`: Git execution, JSON persistence, and submodule update adapters.
- `index.ts`: Oh My Pi adapter and composition root.

The application service depends on the domain and ports; adapters implement
ports. `index.ts` wires them together, keeping Oh My Pi and Git/JSON concerns out
of the domain.

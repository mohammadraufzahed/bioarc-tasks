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
- `/bioarc-task select [id|clear]` selects an open task for the current session; `default` remains an alias.
- `/bioarc-task commit [id]` commits only staged changes in the current checkout for the session-selected task. If no task is selected, the command asks you to choose one.
- `/bioarc-task complete [id]`, `/bioarc-task delete [id]`, `/bioarc-task setup [supervisor]`, `/bioarc-task update`.
The AI receives `bioarc_task_select`, `bioarc_task_create`, `bioarc_task_list`, and `bioarc_task_commit` task tools.

Task IDs are UUIDs; their first eight characters are shown and work as short IDs.
Defaults are persisted in session history and remain separate per session.
Commits include only staged changes and record the resulting hash. Stage only the
task's changes first. Subjects follow:

`نوع کامیت: تسک میزیتو عنوان تسک: <عنوان> فرد محول کننده: <سرپرست>`

Tasks do not provide isolation. If you need parallel checkouts, manage those separately with OMP; this extension does not create or clean them.

## Structure

- `src/domain`: task invariants and commit subject.
- `src/application`: task and setup use cases.
- `src/ports.ts`: repository, Git, project config, and update contracts.
- `src/adapters`: Git execution, JSON persistence, and submodule update adapters.
- `index.ts`: Oh My Pi adapter and composition root.

The application service depends on the domain and ports; adapters implement
ports. `index.ts` wires them together, keeping Oh My Pi and Git/JSON concerns out
of the domain.

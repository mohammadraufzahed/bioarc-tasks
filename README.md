# BioArc Tasks

Oh My Pi extension for managing tasks and creating BioArc-style task commits.
Tasks are stored in each repository's Git directory (`bioarc-tasks.json`), not
in the worktree. Deleting a task removes only its record; Git history is never
rewritten.

## Install

Load `index.ts` as an Oh My Pi extension using the extension path configuration.
Set `BIOARC_SUPERVISOR` to the single supervisor name used in commit subjects.

## Commands

- `/bioarc-task` offers autocomplete for actions and task IDs.
- `/bioarc-task create <title>`
- `/bioarc-task list`
- `/bioarc-task default [id|clear]` selects a session-specific default task. With no ID, opens a task picker.
- `/bioarc-task commit [id]`, `/bioarc-task complete [id]`, `/bioarc-task delete [id]` use the session default when omitted; otherwise open a picker. Type an ID prefix to autocomplete a specific task.

Task IDs are UUIDs; their first eight characters are shown and work as short IDs. Defaults are persisted in session history and remain separate per session. Commit uses only staged changes and records the resulting hash. Review and stage only the selected task's changes first. Delete removes only the task record, never Git history.

Commit subject:

`نوع کامیت: تسک میزیتو عنوان تسک: <عنوان> فرد محول کننده: <سرپرست>`

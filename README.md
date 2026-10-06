# BioArc Tasks

Oh My Pi extension for managing tasks and creating BioArc-style task commits.
Tasks are stored in each repository's Git directory (`bioarc-tasks.json`), not
in the worktree. Deleting a task removes only its record; Git history is never
rewritten.

## Install

Load `index.ts` as an Oh My Pi extension using the extension path configuration.
Set `BIOARC_SUPERVISOR` to the single supervisor name used in commit subjects.

## Commands

- `/bioarc-task list`
- `/bioarc-task create <title>`
- `/bioarc-task complete <id>`
- `/bioarc-task delete <id>`
- `/bioarc-task commit <id>`

Commit only commits already staged changes. Review and stage only the selected
task's changes before running it. Subject format:

`نوع کامیت: تسک میزیتو عنوان تسک: <عنوان> فرد محول کننده: <سرپرست>`

Task IDs are UUIDs; their first eight characters work as short IDs. Commit
hashes are recorded after successful commits. Tasks are local to each Git
repository and are not synced or included in commits.

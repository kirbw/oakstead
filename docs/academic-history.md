# Academic history

Administrators and principals can open **Academic history** from Gradebook or
Absences. Teachers and parents cannot open the history page. Filter by school
year, student, assignment, actor ID, UTC date range or event type. Each page shows
up to 50 changes; Older changes follows an ID cursor so newly added entries do
not shift the remaining pages.

History records score creation, replacement and clearing from all entry forms,
assignment creation/edits/deletion and scores removed with an assignment, and
attendance entries. Each event includes the actor's ID/name/role at the time,
UTC time, request ID, affected record IDs, and before/after values. Unchanged
saves create no event. The history insert and academic mutation share one
transaction: if either fails, both roll back. Ordinary score saves load only the
submitted students for comparison; assignment deletion captures every affected
score. History remains when its original records or actor account are deleted.

History begins when this version is installed. Existing data is not backfilled.
Events are retained indefinitely; there is no history edit/delete operation.
Database administrators can still alter the database directly, so this is
operational history, not a tamper-proof external audit log. Demo actions use the
actor label Demo, and resetting the sample database clears its sample history.

## Compatibility and recovery

Schema version 2 adds `os_academic_history` and indexes through the versioned
migration registry. It does not rebuild existing tables or repair historical
relationships. The migration is transactional; failure leaves both data and the
previous schema version intact and prevents startup. Missing or structurally
invalid history tables in a version-2 backup are rejected during staging.

Supported older backups still restore: they are migrated on a staged copy and
begin with an empty history. **Restoring replaces history as well as school
data.** Events recorded after the backup remain only in the pre-restore backup.
Protect those backups and keep off-machine copies where appropriate.

Reverting application code does not undo version 2. Older code may refuse this
database version. Recover using compatible code and a validated backup; never
manually lower `user_version` or delete the history table to force a downgrade.
Existing orphan-record diagnostics continue to preserve and report violations.

## Verification limitation

The browser tool was attempted but failed during initialization with "trusted
Node process exited unexpectedly; kernel reset"; no screenshot was captured.
HTTP tests verify permissions, escaping, filtering, paging and no-store headers.
Manual visual checks: as admin/principal follow the Gradebook and Absences
history links; inspect a set/zero/clear sequence and assignment deletion; filter
by each field and follow Older changes; check an empty result at desktop and
390x844 widths. Confirm teachers/parents see no link and receive Forbidden at
`/history`. Open Backup Settings and confirm the history restore notice.

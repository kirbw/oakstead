# Application boundaries

Oakstead remains a dependency-free Node/SQLite application with server-rendered
pages. `server.js` composes the database, shared helpers, domain services and views,
and the HTTP listener. `server/assets.js` builds the existing hashed CSS/JavaScript
assets; this extraction preserves CSP, compression and cache behavior.

Domain modules under `server/domains` group authentication, people, academics and
administration. Services take form fields and the authenticated user, validate and
authorize operations, and return text/JSON/redirect result descriptions. They do not
write socket responses. The route adapter translates results only after operations
complete. Authentication also receives request context for existing IP throttling,
CSRF and session-cookie handling.

Record services own transactions. A rejected result or thrown failure rolls back;
multi-step operations can use nested savepoints. Restore/update operations remain
outside a record transaction because they replace connections or invoke workers.
The repository facade injects the application's existing SQLite connection; it
introduces no separate connection, cache or query semantics.

Shared input helpers and dependency-free domain validation distinguish omitted,
blank and invalid values. Academic access owns actual-assignment and student checks
and is used by both reads and writes. Service callers must not substitute submitted
selection fields for authorization of the actual record.

Page routing lives in `server/routes.js`. Domain view factories retain request-local
loading and rendering. Setup keeps its existing section-specific loader/renderer.
Views receive explicit dependencies; no module reaches into entry-point globals or
uses dynamic evaluation. Existing URLs, form names and successful response fields
are compatibility boundaries.

Add regression tests through `npm test`. Services can be tested without HTTP; the
temporary-data harness still exercises the real listener, session/CSRF boundaries,
role restrictions, database transactions and restore recovery.

All responses include a generated `X-Request-ID`. Personalized responses use
`Cache-Control: no-store`; versioned static assets retain immutable caching. JSON
errors preserve `error` and add `ok: false`, `requestId` and a `problem` object
containing status/title/field errors. Successful response fields remain unchanged.
Unexpected failures never expose internal exception messages. Duplicate records
and relationship conflicts return 409; invalid fields return 400; missing sessions
return 401 for JSON callers. Normal form bodies are limited to 1 MiB; multipart
uploads retain the existing 50,000,000-byte limit, enforced by actual bytes as well
as declared length.

The shared browser request helper has a 30-second deadline covering headers and
body consumption, detects authentication loss and malformed responses, and never
automatically retries mutations. Form errors preserve the current DOM values and
associate field errors with the focused alert. Autosave retains its serial queue,
explicit retry/discard behavior, and independent pending values. Authentication
loss offers sign-in in another tab so unsaved work is retained.

## Database versions and recovery

`server/migrations.js` owns ordered migrations using SQLite `user_version`.
Version 1 establishes the existing schema and supported additive columns. Fresh
databases are created and upgraded in one savepoint; recognized unversioned
databases retain their records. Partial/unrelated schemas are rejected. All pending
steps, data changes and the version marker roll back together on failure.
Startup, demo seeding and staged restores share the registry. Future versions are
rejected before initialization writes; automatic downgrades are unsupported.

Append migrations rather than changing released steps. Update version-specific
schema requirements with future steps and test historical fixtures. Default-record
initialization remains idempotent and transactional. Historical relationship
violations remain preserved and reported, not repaired.

On upgrade failure, retain the database for diagnosis; no listener starts against a
failed upgrade. Restore candidates migrate only in a staged copy before replacing
the active file. Existing pre-restore backup and original-file recovery remain.
Reverting code does not undo committed versions; use compatible code or a backup.

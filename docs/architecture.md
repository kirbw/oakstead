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

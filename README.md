# Spotlight

A template-driven builder for internal **product spotlight pages**. Each page has a demo video, then a set of
content sections you add, remove, reorder and edit from an admin panel. Duplicate a page to spin up the next
product, then tweak it.

* **Public pages** `/p/<slug>`, an index of published pages at `/`
* **Admin (Spotlight Studio)** `/admin`
* No build step: Node 22+, Express, vanilla JS. Content in **Postgres (Supabase)** or, for local use, a SQLite file.

## Run it

```bash
npm install
cp .env.example .env      # set ADMIN_PASSWORD
npm start                 # http://localhost:3000/admin
npm test                  # API, security and storage tests (SQLite)
TEST_DATABASE_URL=postgresql://… npm run test:pg   # same suite against Postgres (resets its `spotlight` schema!)
```

If `ADMIN_PASSWORD` is unset in development, a temporary one is printed at startup. In production
(`NODE_ENV=production`) the server refuses to start without it.

## What you can do in the admin

| Area | Capabilities |
|---|---|
| **Pages** | Create from the standard template, **duplicate for another product**, publish / unpublish (drafts are hidden), delete, export / import as JSON |
| **Sections** | 14 types (Hero, Why we built it, Capabilities, How it works, See it in action, Screenshot gallery, Text + media, Results & quotes, Adoption by team, What's new, Roadmap, Get started, FAQ, Contact). Add, **drag to reorder** (or Alt+↑/↓), hide/show, duplicate, delete |
| **Content** | Every field on every section; repeatable items (stats, cards, steps, quotes, FAQ…) can be added, reordered, duplicated and removed |
| **Media** | Upload images (PNG/JPG/GIF/WebP) and video (MP4/MOV/WebM) to the library, pick them into any media field, edit alt text, see where each file is used. Or embed a YouTube / Vimeo / Loom / Stream / SharePoint link |
| **Look** | Palette: Bright Fern primary; Vintage Grape, Dusty Grape, Cool Steel, Honeydew accents; custom colours too. Text colour on buttons and bands adapts automatically so contrast stays readable. Per-section background (tint / white / dark) |
| **Safety net** | Autosave, version history with restore, warning if the page was changed in another tab |
| **Preview** | Live desktop / tablet / mobile preview beside the editor. Click a section in the preview to jump to its form |

## Supabase

Set these three groups and nothing needs to live on the app server's disk.

**Page content (Postgres)**

```
DATABASE_URL=postgresql://postgres.<ref>:<password>@<host>:5432/postgres
```

Copy the URI from *Project Settings > Database > Connection string*. Use the *Session pooler* string if your host
has no IPv6. Tables are created automatically on first start, in their own `spotlight` schema, with Row Level
Security on and no policies, so Supabase's public API and anon key cannot read or change them. The connection is
encrypted; to also verify the server certificate, download Supabase's CA certificate and set `DATABASE_CA` to its path.

**Media (Storage)**

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>
SUPABASE_BUCKET=spotlight-media
```

The bucket is created automatically as **public-read** (the pages need to load the files). The service-role key stays
on the server and is never sent to the browser. Mind your plan's per-object size cap (50 MB on the free tier) and
set `MAX_UPLOAD_MB` to match.

Without `DATABASE_URL` the app uses SQLite at `DATA_DIR/spotlight.db`, and without the Supabase storage variables it
saves uploads to `DATA_DIR/uploads`. Both are fine locally; on a host with an ephemeral disk they would be lost on redeploy.

## Deploying

* Put it behind HTTPS. The admin cookie is `Secure` in production.
* Public pages are not authenticated by the app itself. If they must stay internal, restrict access at the network layer.
* Set `NODE_ENV=production` and `ADMIN_PASSWORD`.

## Security notes

Shared admin password (rate-limited, constant-time compare, HttpOnly + SameSite=Strict cookie, custom header on
every write). All content is HTML-escaped; links are limited to http(s)/mailto/relative; video embeds are limited
to an allow-list (`EMBED_HOSTS` extends it); uploads are identified by file signature, not by name; a strict CSP
is sent on every page.

## Adding a section type

1. Describe its fields in `lib/sections.js` (the admin form is generated from this).
2. Add a renderer to `R` in `lib/render.js`.
3. Style it in `public/site.css`.

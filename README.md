# Spotlight

A template-driven builder for internal **product spotlight pages**. Each page has a demo video, then a set of
content sections you add, remove, reorder and edit from an admin panel. Duplicate a page to spin up the next
product, then tweak it.

* **Public pages** `/p/<slug>`, an index of published pages at `/`
* **Admin (Spotlight Studio)** `/admin`
* No build step: Node 22+, Express, SQLite (`node:sqlite`), vanilla JS.

## Run it

```bash
npm install
cp .env.example .env      # set ADMIN_PASSWORD
npm start                 # http://localhost:3000/admin
npm test                  # API, security and storage tests
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

## Media storage (Supabase)

Uploads go to **Supabase Storage** when these are set, otherwise to local disk (`DATA_DIR/uploads`):

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role key>
SUPABASE_BUCKET=spotlight-media
```

The bucket is created automatically as **public-read** (the pages need to load the files). The service-role key
stays on the server and is never sent to the browser. Mind your Supabase plan's per-object size cap
(50 MB on the free tier); set `MAX_UPLOAD_MB` to match.

## Deploying

* Page content lives in SQLite at `DATA_DIR/spotlight.db`. Put `DATA_DIR` on a **persistent volume**; on
  hosts with ephemeral disks the content would be lost on redeploy.
* Put it behind HTTPS (and your SSO / VPN if pages are internal-only). The admin cookie is `Secure` in production.
* Public pages are not authenticated by the app itself. Restrict network access if they must not be public.

## Security notes

Shared admin password (rate-limited, constant-time compare, HttpOnly + SameSite=Strict cookie, custom header on
every write). All content is HTML-escaped; links are limited to http(s)/mailto/relative; video embeds are limited
to an allow-list (`EMBED_HOSTS` extends it); uploads are identified by file signature, not by name; a strict CSP
is sent on every page.

## Adding a section type

1. Describe its fields in `lib/sections.js` (the admin form is generated from this).
2. Add a renderer to `R` in `lib/render.js`.
3. Style it in `public/site.css`.

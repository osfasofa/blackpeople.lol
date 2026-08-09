# blackpeople.lol

A full-screen, scroll-snapped feed of YouTube music videos. One video per
screen, TikTok-style. Static Astro site, no server, no database — every post is
a markdown file.

```bash
npm install
npm run dev      # http://localhost:4321
```

Node 22+ is required (Astro 7). This repo pins it via `.mise.toml`, so if you
use mise it's automatic.

---

## Publishing a new post

1. Create a file in `src/content/posts/`. The filename becomes the slug:

   ```
   src/content/posts/song-name.md
   ```

2. Fill in the frontmatter:

   ```markdown
   ---
   title: 'Artist — Song Name'
   youtube: dQw4w9WgXcQ
   date: 2026-08-09T14:30:00-04:00
   blurb: 'Optional one-liner.'
   ---
   ```

   **Only `youtube` is required.** This is a complete, valid post:

   ```markdown
   ---
   youtube: dQw4w9WgXcQ
   ---
   ```

   | Field    | Required | Notes                                                          |
   | -------- | -------- | -------------------------------------------------------------- |
   | `youtube`| **yes**  | The **video ID only** — the bit after `v=`, not the full URL.    |
   | `title`  | no       | Omit it and no title renders. Nothing is fetched from YouTube.   |
   | `date`   | no       | Date, or date **and time**. Omit it and the post goes on top.    |
   | `blurb`  | no       | Small line under the title. Works with or without a title.       |

   If a post has neither a title nor a blurb, the overlay gradient doesn't
   render at all — you get bare video, not an empty smudge along the bottom.

   **On dates.** Both `2026-08-09` and `2026-08-09T14:30:00-04:00` work. Include
   the offset when you give a time: a bare `T14:30:00` is read as UTC by the YAML
   parser, which can shove a post onto the wrong day in your timezone.

   Undated posts sort **above** everything dated — dropping in a file with just a
   video ID puts it at the top of the feed, rather than silently burying it at the
   bottom where you'd never see it. Posts sharing a timestamp (and undated posts
   among themselves) fall back to alphabetical order by filename, so the feed is
   never in an arbitrary order.

3. Commit and push:

   ```bash
   git add src/content/posts/song-name.md
   git commit -m "Add Artist — Song Name"
   git push
   ```

That's it. Vercel rebuilds on push. No code changes needed, ever.

**Two gotchas.** The body of the markdown file is ignored — only frontmatter is
read. And the filename is the comment thread key, so **renaming a file orphans
its existing comments**; pick the slug once and leave it.

Not every video allows embedding. If a section renders black, the rights holder
has disabled embedding for that video — you need a different upload of the song.

---

## Comment setup (one-time, manual)

Comments use [giscus](https://giscus.app), which stores each thread as a GitHub
Discussion in this repo.

**This is already done** — the values are filled in and committed. The steps
below are kept as a record of how they were obtained, and for pointing a fork or
a second site at a different repo.

Until the IDs are filled in, the comment drawer still opens and slides correctly
— it just shows a "not configured yet" note instead of a thread.

### On github.com

1. Make sure the repo is **public** (giscus can't read private repos).
2. **Settings → General → Features →** tick **Discussions**.
3. Use the built-in **Announcements** category (or make your own, so long as its
   format is **Announcement**). The format matters: it stops anyone but you from
   creating new top-level threads, so people can only reply to posts.
4. Install the giscus app: <https://github.com/apps/giscus> → **Install** →
   select **only** this repository.

### On giscus.app

5. Open <https://giscus.app> and scroll to **Configuration**.
6. Enter `osfasofa/blackpeople.lol` in the repository field. You should get a
   green checkmark on all four prerequisite checks.
7. Under **Page ↔ Discussions Mapping**, pick **"Discussion title contains a
   specific term"**. (The site overrides the term per post at runtime, so
   whatever you type in the box doesn't matter.)
8. Under **Discussion Category**, choose **Announcements**.
9. Scroll to the generated `<script>` snippet at the bottom and copy the values
   for `data-repo-id` and `data-category-id`.

### In this repo

10. Paste them into `src/config.ts`:

    ```ts
    export const giscus = {
      repo: 'osfasofa/blackpeople.lol',
      repoId: 'R_kgDOTvdXOQ',                 // ← data-repo-id
      category: 'Announcements',              // must match the ID below
      categoryId: 'DIC_kwDOTvdXOc4DC_do',     // ← data-category-id
      ...
    };
    ```

    Two values from giscus.app's snippet are deliberately **not** copied:
    `data-term` (the site sets a per-post term at runtime) and `data-strict`,
    which we keep at `1` so a slug like `despacito` can't match a discussion
    titled `despacito-remix`.

11. Commit and push. Comments are live.

These IDs are **not secrets** — giscus embeds them in client-side HTML by
design. Committing them is correct.

### How threads are keyed

The site is one continuously-scrolling page, so giscus's normal
"one-thread-per-URL" mapping is useless here — every post shares the same URL.

Instead each post uses `data-mapping="specific"` with its slug as the term, so
`despacito.md` gets its own discussion titled `despacito`. The first time
someone comments on a post, giscus creates that discussion automatically.

The widget is only injected when a drawer is first opened — never on page load,
so four comment iframes don't compete with the video for bandwidth. Once opened,
a thread stays mounted and hidden, so reopening it is instant and doesn't lose a
half-typed comment.

---

## Deploying

Import the repo on [Vercel](https://vercel.com/new). Astro is auto-detected;
no configuration and no adapter needed. Build `npm run build`, output `dist/`.
`engines.node` in `package.json` pins the build to Node 22.

---

## Tweaking things

**`src/config.ts`** — the knobs you're most likely to want:

```ts
export const overlay = {
  show: true,       // false = completely bare feed, video only
  showBlurb: true,  // keep titles, drop the blurbs
};
```

**`src/styles/global.css`** — the gradient, type sizes and positioning live
under the `OVERLAY` heading, isolated so you can restyle without touching
anything else. The `--edge` token controls how far chrome sits from the screen
edge.

**Playback rules** are in `src/scripts/player.ts`. `ACTIVE_RATIO = 0.6` is the
share of the screen a section needs before it becomes the playing one.

### Sound behaviour

Browsers won't allow unmuted autoplay, so the first video starts muted with a
"Tap for sound" button top-right. One tap unmutes and that choice sticks in
`sessionStorage` for the rest of the visit — every video after it plays with
sound as it scrolls into view. The button then works as a normal mute toggle.

Tapping the video pauses and resumes it. Opening a comment drawer pauses the
video and closing it resumes.

---

## Layout

```
src/
  config.ts              site + giscus + overlay settings
  content.config.ts      post frontmatter schema
  content/posts/*.md     one file per song
  components/
    VideoSection.astro   one full-screen video
    CommentDrawer.astro  the slide-up panel (one, reused)
  scripts/
    player.ts            IFrame API, IntersectionObserver, sound
    comments.ts          drawer + lazy giscus mounting
  styles/global.css
  pages/index.astro
```

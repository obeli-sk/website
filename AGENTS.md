# Website — Obelisk Project Website (obeli.sk)

Built with [Zola](https://www.getzola.org/) static site generator.
Hosted at https://obeli.sk.

## Running Locally

```sh
zola serve --port 8000 --interface 0.0.0.0
```

Or via Nix:
```sh
nix develop --command zola serve --port 8000 --interface 0.0.0.0
```

Zola watches for changes and live-reloads.

## Repo Structure

```
website/
├── config.toml              # Zola config: base_url, version list, extras
├── content/
│   ├── _index.md            # Homepage (template: index.html)
│   ├── blog/                # Blog posts (sorted by date)
│   │   ├── _index.md        # Blog list (template: blog_list.html)
│   │   └── YYYY-MM-DD-*.md  # Individual posts (template: blog_page.html)
│   ├── docs/
│   │   ├── _index.md        # Docs landing (template: docs_versions.html)
│   │   ├── latest -> v0.X.Y # Symlink to current version
│   │   └── v0.X.Y/          # Versioned docs (template: docs_toc.html / docs.html)
│   │       ├── _index.md    # Version TOC (sort_by = "weight")
│   │       ├── getting-started.md
│   │       ├── cli.md
│   │       ├── configuration.md
│   │       ├── programmatic-access.md
│   │       └── concepts/    # Nested doc sections
│   └── install/             # Install page (template: install.html)
├── sass/
│   └── style.scss           # All site styling (compiled by Zola)
├── static/                  # Static assets (images, JS, video)
├── templates/
│   ├── base.html            # Base layout: nav, head, content block
│   ├── macros.html          # Shared macros: render_toc, doc_breadcrumb
│   ├── shortcodes/          # Zola shortcodes for use in Markdown
│   │   ├── doc_link.md      # Version-aware doc cross-references
│   │   ├── github.md        # Links to GitHub source files
│   │   ├── get_url.md       # URL helper
│   │   └── target_link.md   # External links with target="_blank"
│   └── *.html               # Page-specific templates
├── scripts/
│   ├── bump-version.sh      # Version bump automation
│   └── screenshot-webui.js  # Playwright script to capture WebUI trace screenshots
├── validation/              # JS docs validation deployments (run ./test.sh in each)
└── flake.nix                # Nix devShell (zola, wrangler)
```

## Versioned Docs

Docs are versioned under `content/docs/vX.Y.Z/`. The `content/docs/latest`
symlink points to the current version.

Many older version directories are symlinks to the nearest real directory
with actual content. Only a few versions have real content directories.


## Formatting
use
```sh
./scripts/fmt-md.sh
```
after each edit.

### Adding a New Version

```sh
./scripts/bump-version.sh v0.36.0 v0.35.0
```

This creates a symlink `content/docs/v0.36.0 -> v0.35.0`, updates the
`latest` symlink, and updates `config.toml` (latest field + versions list).

## Styling

All CSS is in `sass/style.scss`. Key design tokens are CSS custom properties:

```scss
--primary: #9df2fe;      // Cyan accent
--primary-dark: #70d9e5; // Hover state
--bg-dark: #1e1e2e;      // Page background
--bg-lighter: #282a36;   // Nav, cards
--text: #e4e4e7;         // Body text
--highlight: #8be9fd;    // Gradient highlight
```

The site uses a dark theme throughout. Tables, code blocks, and blockquotes
are styled within the `article` scope so they only affect doc/blog content.

Zola renders Markdown tables as bare `<table>` elements (no wrapper div).

## Templates

- **base.html** — Shared layout with nav bar. All other templates extend this.
- **docs.html** — Single doc page with breadcrumb and article content.
- **docs_toc.html** — Version index with recursive TOC via `macros::render_toc`.
- **docs_versions.html** — Docs landing showing all versions.
- **blog_page.html** / **blog_list.html** — Blog post and listing.
- **index.html** — Homepage with hero, feature grid, screencast.

## Shortcodes

Used in Markdown content:

- `{{ doc_link(title="...", path="...") }}` — Cross-reference within the
  same docs version. Auto-detects version from page ancestors.
- `{{ github(title="...", path="...") }}` — Link to a file in the obelisk
  GitHub repo at the matching version tag.
- `{{ target_link(title="...", href="...") }}` — External link with
  `target="_blank"`.

## Screenshots

Homepage carousel screenshots (`static/sc-*.png`) are captured with Playwright. Use the
`screenshots` devShell (`nix develop .#screenshots`) which provides `node` and `playwright`
on `$PATH`. To regenerate:

1. Start the demo-tutorial server:
   ```sh
   cd /workspace/apps/demo-tutorial
   obelisk server run --deployment deployment.toml
   ```
2. Trigger both workflows and wait for the serial one (~30 s) to finish:
   ```sh
   curl http://localhost:9090/serial & curl http://localhost:9090/parallel; wait
   sleep 30
   ```
3. Run the capture script from `website/`:
   ```sh
   nix develop .#screenshots -c node scripts/screenshot-webui.js
   ```
4. Copy outputs to `static/`:
   ```sh
   cp /tmp/sc-*.png static/
   ```

The script captures four views at 1280×680 pixels: execution list, parallel trace, event log, and
logs. It auto-detects serial vs parallel by timing and always uses the two most recently created
executions. See `scripts/screenshot-webui.js` for details.

## Validation

`validation/` contains small self-contained Obelisk deployments that verify claims in the JS docs
(return types, JSON encoding). Each subdirectory has a `test.sh`. Requires `obelisk` on `$PATH`.

## Content Conventions

- Doc pages use `template = "docs.html"` and `weight = N` for ordering.
- Blog posts are named `YYYY-MM-DD-slug.md` with `date` in frontmatter.
- Section `_index.md` files set the template and sorting.
- Static assets for blog posts go in `static/blog/`.

## Config

`config.toml` key fields:
- `extra.latest` — Current version string (e.g. `"v0.35.3"`).
- `extra.versions` — Ordered list of all versions for the version picker.
- `[markdown].highlight_code = true` — Syntax highlighting enabled.

## Deployment

The site is deployed via Cloudflare Workers (wrangler is in the Nix devShell).
The `public/` directory contains build output from `zola build`.

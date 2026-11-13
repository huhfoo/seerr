# Episode requests and release selection

Expand a season on a series details page. Each episode has a **Request** button
that requests only that episode using the default Sonarr settings and Seerr's
existing permissions, quotas, and approval flow. The button shows requested,
pending approval, or available state. When both standard and 4K requests are
enabled for your account, select the quality beside the buttons.

Users with **Manage Requests** also see **Choose Release**. This expands the shared
release list beneath the episode. Choose a result and press **Download Selected
Release**. Rejected releases remain visible but cannot be submitted. Sonarr's
ordering, scores, and matched-format tooltips are preserved. Seerr does not sort
releases by custom-format score alone. Thumbnails remain artwork.

Search and submission errors appear inline. If the request was saved but grabbing
the release failed, the error explains that the request remains saved. Select a
release and try again; the existing request API prevents duplicate active episode
requests. Release selection also works for already requested or available episodes.
Current Sonarr file state takes precedence over historical request completion.

The standard **Request Series** dialog handles whole-season requests and advanced
server/profile overrides. Individual episode selection lives only in the seasons
view. Pending episode requests can still be viewed, approved, or canceled through
the existing request controls; their episode selections cannot be changed into
whole-season requests.

Quotas count distinct seasons in each request. Episode requests monitor and search
only the selected episodes. Newly added series start with other episodes and
future seasons unmonitored. Existing Sonarr monitoring is preserved, so other
episodes already monitored there can continue to download. Enable Sonarr
synchronization to complete a request when all its selected episodes have files.
Episode-only requests do not reserve the whole season; a partially available
season can still be requested.

For movies, users with **Manage Requests** can enable **Choose a Release Manually**
when requesting a title. This skips the initial automatic search. Once Radarr
accepts the title, open **Manage → Browse releases** or **Browse 4K releases**.
The same browser supports TV season packs and individual episodes. Results include
release groups when supplied by Sonarr/Radarr, quality, scores, size, indexer,
protocol, seeders, and rejection reasons. Season packs can contain other episodes.
Existing monitoring and RSS behavior in Sonarr/Radarr still apply.

## Fork maintenance

Episode actions use Seerr's existing buttons, alerts, badges, SWR, and shared
release results. The bulk TV request dialog retains the upstream season table.
The superseded episode picker and its custom controls have been removed.
No new dependencies or replacement scoring/request engines are needed.

Release routes are isolated in `server/routes/releases.ts`. Upstream TV and media
route modules, Dockerfile, and version handling remain unchanged. Storage adds
only `episodes` and `manualSearch` to media requests, with SQLite and PostgreSQL
migrations. Keep remote deployment configuration separate from this fork.

## Local build

Use the upstream build-tag argument so frontend and backend agree on the version:

```sh
docker buildx build --load --build-arg COMMIT_TAG=local -t seerr-local .
```

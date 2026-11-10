# Local OpenStreetMap extract for discovery: resource plan and runbook

Status: code built and tested on synthetic fixtures. **Nothing has been downloaded, installed or loaded.** Every step marked "needs approval" stays blocked until the owner approves it.

## Why this replaces public Overpass

On 2026-10-26 the public Overpass instance answered a permitted test query with HTTP 502 "at capacity" and stated that the endpoint is for browser-based and human-operated tools, recommending a local instance for automated use. Discovery therefore reads a local extract instead. The provider abstraction is unchanged, so a commercial provider can still be added later as another `DiscoveryProvider`.

## Design

- Source: Geofabrik `africa/south-africa-latest.osm.pbf`. Geofabrik defines no provinces for South Africa, so the Western Cape is bounded locally (see "Western Cape bounds").
- Pipeline: `osmium tags-filter` (keep only the 10 configured industries plus named places) then `osmium export` to GeoJSON sequence, then `pnpm osm:extract load`, which clips to the bounding box and writes the `osm_source` schema.
- Storage: a separate Postgres schema, `osm_source` (`datasets`, `places`, `localities`), added by migration `0010`. It is global public reference data, never workspace-owned, and read only by the discovery provider. Discovery copies selected rows into workspace `companies` with source attribution, using the existing fill-missing upsert, so user-entered fields are never overwritten.
- Search: the user names a place (for example Stellenbosch). The provider finds that place in the extract and returns matching businesses within a radius (default 10 km, set with `OSM_EXTRACT_RADIUS_KM`, 1 to 50), nearest first, with cursor paging. Results are approximate by distance, not by administrative boundary. Exact boundary search would need PostGIS, which the current `postgres:17-alpine` image does not include.
- No network requests at search time. Local run limits are lighter than for public APIs (2 s between runs, 60 per hour, 300 per day per workspace).

## Verified facts

| Item | Value | Source |
| --- | --- | --- |
| South Africa extract | 403 MB shown (423,205,732 bytes for the dated 2026-10-25 file) | Geofabrik page, 2026-10-26 |
| Data currency | OSM data up to 2026-10-25 21:21 UTC; updated daily | Geofabrik page |
| Western Cape sub-extract | Not offered ("no sub regions are defined") | Geofabrik page |
| This machine | 15.7 GB RAM (about 1.8 GB free at the time of checking), 20 logical cores | Windows query |
| Drive D: | 1,420 GB free | Windows query |
| Drive C: | 233 GB NVMe SSD, **0.3 GB free** (1 GB earlier the same day) | Windows query |
| Docker's disk | **Already on D:** (`D:\HOAX1G\INSTALLED APPS\DockerDesktopWSL\disk\docker_data.vhdx`, 4.15 GB); set by `CustomWslDistroDir` in Docker Desktop settings. Docker folders on C: total about 0.03 GB | settings file, file listing |
| Drive D: type | 2 TB spinning hard disk (Seagate ST2000DM008), NTFS, healthy. Expect slower disk work than on C: | Windows query |
| Memory pressure | 2.0 GB free; commit charge 28.1 of 30.8 GB; pagefile (15 GB on C:) 9.3 GB in use. Docker's VM is capped at 7.6 GB and uses about 0.7 GB | Windows query, `docker info` |
| Docker today | 6 images (1.16 GB), 7 volumes (235 MB) | `docker system df` |
| osmium on Windows | listed on conda-forge for win-64; no Windows binary or Docker image is documented | osmium-tool page |
| osmium memory | `tags-filter` keeps ID tables in RAM and may read the input up to 3 times; `extract` needs at least (highest node id / 8) bytes per extract, so about 1.7 GB or more at current node ids, and is skipped by this plan; `export` keeps node locations in RAM | osmium manual |

## Estimates (not measured; refine after the first real scan)

| Resource | Estimate | Notes |
| --- | --- | --- |
| Download | 0.4 GB, once | Re-download only to refresh (monthly is plenty) |
| Filtered PBF | 0.03 to 0.15 GB | Intermediate, can be deleted |
| GeoJSON sequence | 0.1 to 0.5 GB | National filtered set; intermediate, can be deleted |
| Postgres rows (Western Cape) | about 20,000 to 100,000 places, 20 to 150 MB with indexes | Must not land on C: (see below) |
| Peak RAM | about 1 to 2 GB (osmium) and under 0.3 GB (loader) | Close heavy apps first; free RAM is low right now |
| Time | minutes: filter 1 to 5, export 1 to 3, load 1 to 3 | |
| Tool install | micromamba (10.9 MB, single exe) plus osmium-tool 1.19.1 (0.5 MB package) and its small dependencies: about 0.1 to 0.2 GB on D: | Sizes verified from release metadata; not installed |

Peak disk on D: during a run is under about 2 GB, plus about 1 GB for tools.

## Measured results (first real run, 2026-10-26)

These replace the estimates above where they overlap. Everything ran on D: with `TEMP` on D:; no database was touched.

| Item | Measured |
| --- | --- |
| Download | 423,205,732 bytes in 54 s; MD5 matched Geofabrik's published value; SHA-256 `511968E475FC09F4346A9E1D7B56898BF4732123FE0C5E46196BD88D463176D8` |
| Data timestamp | 2026-10-25T21:21:21Z (from the file header) |
| Raw file contents | 81,935,568 nodes, 7,064,129 ways, 41,170 relations |
| `osmium tags-filter` | 4 s, **peak 2.08 GB RAM**, output 1.3 MB (60,613 nodes, 3,844 ways, 86 relations including referenced members) |
| `osmium export` | 0.3 s; 26,246 features (22,508 points, 3,738 multipolygons); 7.2 MB; every line carries the RS separator; ids are `n…` and `a…` |
| Tools on D: | 84 MB (micromamba plus osmium 1.19.1) |
| Scan, Western Cape box | **5,465 businesses and 1,081 named places**; skipped 18,139 outside the box, 1,553 without a name, 8 not matching; no format-related skips |
| Scan, all South Africa | 17,459 businesses, 7,215 named places |
| Businesses in the Western Cape box | Restaurants and cafes 2,454; hotels and accommodation 1,427; retail 580; beauty and wellness 300; automotive 280; medical and dental 236; real estate 109; legal and accounting 50; travel 23; construction and engineering 6 |
| Contact coverage (Western Cape) | website 28% (about 1,558), phone 30%, email 12%, addr:city 26%, any province tag 2% |

**Load incident (2026-10-26):** the first `load` read 26,079 of 26,246 lines and published an incomplete dataset (5,461 businesses, 1,046 places). Cause: the CLI created its readline reader before the loader's first database insert, and lines emitted during that wait were discarded (reproduced on the real file: a 2 ms wait gives exactly 26,079 lines, 10 ms gives 15,860, 30 ms hangs). Fixed by creating the reader lazily (`streamLines`) and by an `expectedLines` guard that fails the load, deletes its rows and publishes nothing when the counts differ. Migration `0010` itself was verified additive and all 42 existing tables were unchanged by it. The corrective reload then ran: 26,246 of 26,246 lines consumed, 5,465 businesses and 1,081 named places (node, way and relation id sets matched an independent recount of the raw file exactly), one `ready` dataset, the incomplete one `superseded` and preserved, and all 42 original tables unchanged. Provider preview on real data: Real Estate Agencies within 10 km of Stellenbosch returned 15 records over 3 pages without duplicates (7 with a website), and 30 within 25 km.

What this means: the pipeline and parser work on real data, and the database footprint will be a few MB, far below the earlier estimate. OpenStreetMap coverage is the limiting factor: only about 1,558 Western Cape businesses list a website (the ones website audits can use), and some sectors are thin (legal and accounting 50, construction 6). Treat discovery as a supplement to CSV import and commercial data, not a complete directory. Province tags are rare, so province is not assigned unless tagged; search by town.

## Where things live (all on D:)

```
D:\HOAX1G\OSM-Data\
  raw\    south-africa-latest.osm.pbf   (+ checksum)
  work\   expressions.txt, filtered.osm.pbf, filtered.geojsonseq
D:\HOAX1G\Tools\                        (micromamba.exe, osmium-env, mamba-root)
```

## Storage and memory safety (checked 2026-10-26)

**Docker needs no relocation.** Its disk image is already on D:, which has about 1,420 GB free, so loading the dataset into Postgres grows a file on D:. All 7 Docker volumes together are 235 MB (the PRIZM volume is 51 MB). The earlier assumption in this plan that Docker's data sat on C: was wrong for this machine. The Docker Desktop "Disk image location" setting is documented only for Mac, Linux and Hyper-V, not WSL 2, which is why `CustomWslDistroDir` is the relevant setting here; nothing about it needs to change.

**Drive C: is the real blocker, independent of this feature.** It has 0.3 GB free and is shrinking. A full system drive breaks builds, installers, caches, the pagefile and Windows itself. Largest items found (sizes read-only, nothing deleted): Spotify data 9.0 GB, `AppData\Local\hermes` 12.4 GB (Hermes agent install), Google/Chrome 5.8 GB, `.cache\codex-runtimes` 3.3 GB, TikTok LIVE Studio 2.7 GB, `ms-playwright` 1.4 GB, temp files 1.5 GB. Music-production data (for example `AppData\Roaming\RevealSound`, 3.1 GB) must not be touched.

**Do not move the pagefile to D:.** D: is a spinning disk and the pagefile is actively in use (9.3 GB), so moving it would slow the whole system. Free space on C: instead.

**Memory:** the commit charge is at 91% of its limit, so close Discord, ChatGPT, Chrome and Spotify before the osmium and loader steps. Peak need is estimated at 1 to 2 GB; with those closed there is ample headroom.

**Keep every temporary file on D:** set `TEMP` and `TMP` to `D:\HOAX1G\OSM-Data\tmp` for the shell that runs the steps, and set `MAMBA_ROOT_PREFIX` to `D:\HOAX1G\Tools\mamba-root` (micromamba keeps its package cache there), so tooling never writes to C:.

## Approval checklist

1. Download about 403 MB to `D:\HOAX1G\OSM-Data\raw\` from Geofabrik.
2. Download `micromamba-win-64.exe` (10.9 MB, official `mamba-org/micromamba-releases` release 2.9.0-0, SHA-256 `a6d804394b2418991c4e29562853eaace2f2ce9d9da661a98e74e02e8dbb44b0`), verify the hash, and use it to install `osmium-tool` 1.19.1 from conda-forge into `D:\HOAX1G\Tools`.
3. Free at least 5 to 10 GB on C: (owner's choice of what to clear; see "Storage and memory safety"), and run all steps with `TEMP`/`TMP` on D:.
4. Apply migration `0010` to the local Postgres (`pnpm db:migrate`). It only adds the `osm_source` schema and does not touch existing tables.
5. Load the filtered extract with `--confirm-write`.
6. Set `DISCOVERY_PROVIDER=osm_extract` and `DISCOVERY_TERMS_VERIFIED_FOR=osm_extract` in `.env` (the second is the owner's confirmation of the ODbL terms).

## Runbook (only after approval)

```powershell
$D = "D:\HOAX1G\OSM-Data"
New-Item -ItemType Directory -Force "$D\raw","$D\work","$D\tmp" | Out-Null
$env:TEMP = "$D\tmp"; $env:TMP = "$D\tmp"   # keep every temporary file off drive C:

# 0. Tools on D: (micromamba 2.9.0-0, then osmium-tool from conda-forge; nothing is written to C:)
$T = "D:\HOAX1G\Tools"; New-Item -ItemType Directory -Force $T | Out-Null; $env:MAMBA_ROOT_PREFIX = "$T\mamba-root"
curl.exe -L -o "$T\micromamba.exe" https://github.com/mamba-org/micromamba-releases/releases/download/2.9.0-0/micromamba-win-64.exe
(Get-FileHash "$T\micromamba.exe" -Algorithm SHA256).Hash   # must equal A6D804394B2418991C4E29562853EAACE2F2CE9D9DA661A98E74E02E8DBB44B0, otherwise stop
& "$T\micromamba.exe" create -y -p "$T\osmium-env" -c conda-forge osmium-tool
& "$T\osmium-env\Library\bin\osmium.exe" --version          # path is the usual Windows layout; confirm on first run

# 1. Download (about 403 MB), then verify it against Geofabrik's published .md5 and record a SHA-256
curl.exe -L -o "$D\raw\south-africa-latest.osm.pbf" https://download.geofabrik.de/africa/south-africa-latest.osm.pbf
Get-FileHash "$D\raw\south-africa-latest.osm.pbf" -Algorithm SHA256

# 2. Filter to the configured industries and named places (expressions come from the app's own table)
pnpm osm:extract expressions | Set-Content "$D\work\expressions.txt"
osmium tags-filter "$D\raw\south-africa-latest.osm.pbf" -e "$D\work\expressions.txt" -o "$D\work\filtered.osm.pbf" -O

# 3. Export features with geometry and OSM ids
osmium export "$D\work\filtered.osm.pbf" -f geojsonseq --geometry-types=point,polygon -u type_id -o "$D\work\filtered.geojsonseq" -O

# 4. Dry run: parse and count, no database
pnpm osm:extract scan --file "$D\work\filtered.geojsonseq"

# 5. Load (writes to the database; needs approval)
pnpm osm:extract load --file "$D\work\filtered.geojsonseq" --data-timestamp 2026-10-25T21:21:21Z --sha256 <hash> --confirm-write

# 6. Clean up old datasets after a refresh
pnpm osm:extract purge --confirm-write
```

Refresh: repeat steps 1 to 5. A new dataset becomes active only after it loads completely; the previous one is then marked superseded. A failed load leaves the active dataset untouched.

## What is not yet verified

- The osmium commands and the exact shape of `osmium export` output are taken from the manuals; the parser is tested on synthetic lines written to that shape. The first real `scan` is the real test. If counts look wrong (for example many `invalid_feature` or `missing_id` skips), stop and inspect before loading.
- The resource estimates above are estimates.
- `healthcare=clinic` and the other tags were verified as documented and in use; their South African coverage was not measured.

## Western Cape bounds

`WESTERN_CAPE_BBOX` in `src/modules/prospecting/osm-extract.ts` is an approximate rectangle (lon 17.5 to 24.6, lat -35.0 to -30.2). It includes slivers of neighbouring provinces, so records are not labelled with a province unless OpenStreetMap tags one. Adjust with `--bbox` or load the whole country by passing a wide box.

## Licence and attribution

OpenStreetMap data is licensed under the ODbL; credit "© OpenStreetMap contributors". The dataset row stores the source URL, data timestamp, licence and attribution, and every saved company source carries the dataset id and data date.

## Later: commercial providers

Implement `DiscoveryProvider` (see `src/modules/prospecting/providers.ts`), set its `limits`, add its id to `DISCOVERY_PROVIDER`, and verify its storage terms first. Nothing else in discovery, persistence or the UI needs to change.

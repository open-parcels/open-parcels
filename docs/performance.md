# Performance at history-import scale

Target (TODO §2): 10,000 parcels and 5,000 orders, list endpoints under 200 ms p95 on the NAS in a
container capped at 384 MB, memory stable.

## How to reproduce

From a built checkout (`npm run build -w server`), in `server/`, without network access (the seeded
connections are made up; a server that cannot reach a carrier only logs network errors):

```sh
docker run --rm --network none --memory=384m --cpus=2 -e OPENPARCELS_DATA_DIR=/data \
  -v "$PWD/..:/w:ro" -v /some/empty/dir:/data -w /w/server node:26 bash -c '
    node dist/tools/seed-scale.js > /data/seed.json &&
    OPENPARCELS_BENCH_TOKEN=$(node -p "JSON.parse(require(\"fs\").readFileSync(\"/data/seed.json\")).token") \
      node dist/tools/bench-scale.js --runs 40'
```

- `seed-scale` (`--parcels`, `--orders`) refuses a database that holds parcels. It writes, from a
  fixed seed: 5 connections, 5,000 orders (1–4 lines with picture addresses, about 1 in 25 with a
  return), 10,000 parcels over four years (three in four in an order, about 1 % active, older ones
  archived), 4–12 events each (about 80,000; 40 % with a position), 1–2 items each. The database
  is about 56 MB.
- `bench-scale` starts `dist/main.js`, asks each endpoint `--runs` times in a row after two warm-up
  calls, and prints p50/p95/max and the server's resident memory.

## Results (NAS, 384 MB, 2 CPUs, 2026-11-25)

The NAS was busy (load 7–16) during the runs; p95 moves by ±50 % between runs, p50 much less.

| Endpoint | Before p50 / p95 ms | After p50 / p95 ms | KB |
| --- | --- | --- | --- |
| parcels, first page (100) | 23 / 48 | 26 / 68 | 203 |
| parcels, web UI page (1000; ~100 active) | 34 / 43 | 36 / 71 | 410 |
| parcels + archived, page at offset 5000 | 89 / 119 | 17 / 26 | 204 |
| parcels, status filter | 5 / 6 | 5 / 7 | 21 |
| parcels + archived, carrier filter | 24 / 41 | 19 / 28 | 202 |
| parcels, active (map) | 11 / 14 | 11 / 21 | 91 |
| orders, open (100) | 129 / 263 | 79 / 192 | 101 |
| orders, web UI page (500) | 109 / 209 | 82 / 164 | 101 |
| orders, all, page at offset 2000 | 166 / 381 | 87 / 162 | 178 |
| returns, open | 11 / 14 | 9 / 16 | 3 |
| calendar, six weeks | 39 / 52 | 41 / 56 | 80 |
| status | 4 / 8 | 2 / 5 | 2 |
| sync from the start (one page) | 56 / 84 | 41 / 56 | 228 |
| sync since a cursor | 56 / 105 | 58 / 137 | 220 |

Server memory: 210–225 MB after start, 200–230 MB after all runs (peak 232–239 MB); no growth
over the runs.

### Re-measured with the order list paged in SQL (NAS, 384 MB, 2 CPUs, 2026-11-26)

Same seed and runs, load 5–7. The order list is two to four times faster than the "After" column;
every endpoint stays under 200 ms p95.

| Endpoint | p50 / p95 / max ms | KB |
| --- | --- | --- |
| parcels, first page (100) | 20 / 55 / 73 | 203 |
| parcels, web UI page (1000; ~100 active) | 34 / 52 / 296 | 410 |
| parcels + archived, page at offset 5000 | 17 / 21 / 23 | 204 |
| parcels, status filter | 5 / 7 / 8 | 21 |
| parcels + archived, carrier filter | 19 / 23 / 38 | 202 |
| parcels, active (map) | 11 / 16 / 21 | 91 |
| orders, open (100) | 39 / 48 / 77 | 101 |
| orders, web UI page (500) | 39 / 63 / 87 | 101 |
| orders, all, page at offset 2000 | 48 / 67 / 83 | 178 |
| returns, open | 7 / 8 / 13 | 3 |
| calendar, six weeks | 39 / 71 / 102 | 80 |
| status | 2 / 4 / 5 | 2 |
| sync from the start (one page) | 37 / 57 / 64 | 228 |
| sync since a cursor | 45 / 66 / 79 | 220 |

Server memory: 229 MB after start, 241 MB after all runs (peak 241 MB).

### Re-measured with the parcel list searched, sorted and paged in SQL (NAS, 384 MB, 2 CPUs, 2026-11-26)

Same seed and runs, load 4–5. The web UI's parcel page is now 200 parcels on the way (it was
1000 rows of every parcel); the search, sort and count rows are new. Every endpoint stays under
200 ms p95.

| Endpoint | p50 / p95 / max ms | KB |
| --- | --- | --- |
| parcels, first page (100) | 19 / 29 / 40 | 203 |
| parcels, web UI page (200 on the way) | 9 / 13 / 17 | 91 |
| parcels + archived, search and sort by name (200) | 37 / 52 / 77 | 400 |
| parcels + archived, sort by expected, page at offset 4000 | 62 / 97 / 105 | 397 |
| parcel counts | 33 / 57 / 235 | 1 |
| parcels + archived, page at offset 5000 | 22 / 39 / 45 | 204 |
| parcels, status filter | 6 / 13 / 20 | 21 |
| parcels + archived, carrier filter | 19 / 29 / 32 | 202 |
| parcels, active (map) | 10 / 18 / 22 | 91 |
| orders, open (100) | 46 / 65 / 161 | 101 |
| orders, web UI page (500) | 46 / 77 / 81 | 101 |
| orders, all, page at offset 2000 | 60 / 107 / 113 | 178 |
| returns, open | 9 / 22 / 27 | 3 |
| calendar, six weeks | 44 / 57 / 80 | 80 |
| status | 2 / 2 / 2 | 2 |
| sync from the start (one page) | 37 / 54 / 58 | 228 |
| sync since a cursor | 37 / 44 / 54 | 220 |

Server memory: 247 MB after start, 245 MB after all runs (peak 263 MB).

## What changed

- **Visibility check** (`db/visibility.ts`): "shown unless every connection is disabled" was two
  correlated subqueries per parcel or order. It is now "not in the hidden set", a list built once
  per query from the disabled connections (empty when none is disabled). The parcel query no
  longer reads every row to check it.
- **Sort index** `parcels_updated (updated_at desc, id)` (migration 0028): deep pages walk the
  index instead of sorting all parcels.
- **Order list**: sorted by plain string comparison instead of `localeCompare`.
- **Web UI**: the parcel table and the order grid load one server page of 200 rows or cards and a
  "Show more" button; the count reads "200+" while more follow. Chosen over a virtualised table:
  no new dependency, rows stay real table rows for screen readers and the browser's find.
- **Parcel list** (`parcels/list-query.ts`): the Show filter, carrier, search (`q`, every word in
  the tracking number, label, carrier, status, item names or order) and sort (`sort`, one column)
  run in SQL. The default sort still walks `parcels_updated`; other sorts sort the filtered rows
  (97 ms p95 at offset 4000 of all 10,000). `GET /api/v1/parcels/counts` gives the Connections
  page and the carrier filter their numbers in three grouped queries; the map asks only for the
  parcels on the way (`active=true`).

## Left as it is

- The order list now picks its page in SQL (`orders/list-query.ts`): status and archiving are
  derived from the visible parcels in one grouped query, filtered, sorted and paged by the
  database; only the page is built. Not stored: a stored status would have to follow every parcel
  write, connection toggle and the 30-day rule for orders without parcels. A test holds the SQL
  and `order-lifecycle.ts` to the same answers on 300 generated orders. Re-measured on
  2026-11-26 (above): 48–67 ms p95. Not yet measured on the Pi.
- The map still loads every parcel on the way (about 100 at this scale, 91 KB). Not yet measured
  on the Pi.

## Regression test

`server/test/api/scale.test.ts` seeds the same data in the test run and checks every list endpoint
against a 2 s budget (ten times the NAS figures, so slow machines pass) and the query plans: the
parcel page uses `parcels_updated` without a temporary sort, and visibility is a list subquery.

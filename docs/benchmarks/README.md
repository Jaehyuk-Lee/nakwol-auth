# Authorization lease benchmark (2026-09-29)

## Method

The actual `protect install --provider cloudflare-workers` output runs in Miniflare/workerd with Cloudflare Static Assets, including `run_worker_first`. The fixture has **312 protected requests: HTML 1, JS 4, CSS 3, JSON 4, SVG images 300**. Images are deliberately small, valid SVGs to isolate authentication overhead. These results do not predict bandwidth/decode costs of production image files.

The central `/me` fixture returns a valid member, user ID, application binding and one-hour token expiry, with a controlled **100 ms response delay**. It is not production AUTH. Initial session creation costs one `/me` in both versions and precedes the page measurements. No production tokens or secrets are used.

Two surfaces were exercised:

1. Chrome loading the real fixture through a loopback HTTP adapter to the generated HTTPS-origin gate. Browser cookies remain HttpOnly/Secure/SameSite=Lax; Chrome permits Secure cookies on localhost. The test adapter translates localhost to the configured fixture origin. It is not shipped with the gate. Chrome uses six HTTP/1.1 connections; production HTTP/2/HTTP/3 scheduling and CDN geography may differ.
2. A Node request driver using real workerd dispatch, six concurrent requests, plus a 300-request simultaneous burst. This measures request completion, not browser rendering.

The gate source is unmodified in each generated fixture. Benchmark-only adapter instrumentation records elapsed wall time before the asset binding is called. **This is not Worker CPU time**; the workerd clock is coarse, and waiting time is included. The historical runtime comes from commit `18ef2aa1510e6d34314fc19744eb2d29e978da17`. JSON artifacts include the exact gate SHA-256. Git checkout CRLF versus `git show` LF explains the original versus replay baseline byte hash difference.

## Chrome results (all 300 Resource Timing entries verified)

| Metric | Before first load | After first load | Before revisit | After revisit |
|---|---:|---:|---:|---:|
| Protected requests | 312 | 312 | 312 | 312 |
| `/me` calls / central round trips | 53 | **0** | 53 | **0** |
| HTML TTFB | 136.8 ms | 28.7 ms | 117.5 ms | 6.9 ms |
| Image TTFB, mean | 118.7 ms | 17.9 ms | 119.5 ms | 11.1 ms |
| All 300 images, first start to last response end | 6529.2 ms | 1281.9 ms | 6485.3 ms | 945.5 ms |
| Page `loadEventEnd` | 6710.2 ms | 1376.4 ms | 6636.9 ms | 1024.9 ms |
| Worker authorization wall time, mean | 102.94 ms | 0.163 ms | 108.63 ms | 0.119 ms |
| Aggregate central wait | 5581.2 ms | 0 ms | 5810.6 ms | 0 ms |
| Conditional 304 responses | 0 | 0 | 312 | 312 |

Browser artifacts: `browser-before-first-page.json`, `browser-before-reload.json`, `browser-after-first-page.json`, `browser-after-reload.json`. Each contains raw Navigation/Resource Timing plus server-observed request status and authorization timings. The corrected collector calls `performance.setResourceTimingBufferSize(1000)` before loading assets and rejects reports with fewer than 300 image entries.

Earlier collector runs hit the browser's default Resource Timing buffer limit. They are retained locally under `.wrangler/lease-benchmark-diagnostics/` for traceability and **are excluded from the acceptance table**.

## Controlled workerd checks

The original pre-edit baseline is retained as `authorization-lease-before.json`: 53 `/me` calls, 6482.8 ms first page, 6453.0 ms revisit. The byte-equivalent historical replay (`authorization-lease-before-replay.json`) additionally records image-batch boundaries: 6224.9 ms for all 300 images.

The final `authorization-lease-after.json` records:

- First page: **0** `/me`, 1044.7 ms, 970.0 ms image batch.
- Revisit: **0** `/me`, 562.6 ms; all 312 responses are 304 with zero body bytes.
- Simultaneous 300-image burst inside the lease: **0** `/me`.
- Simultaneous 300-image burst after advancing the **fixture-only** clock by 300001 ms: **1** `/me`, 300 successful 304 responses, 679.7 ms completion time. This verifies coalescing in one isolate, not global coordination across Cloudflare isolates.
- `protect verify`: **1252 / 1252 passed** before and after, covering generated inventory and GET/HEAD/Range/invalid-cookie probes.

The zero-delay control captures show that adding a 100 ms AUTH delay increased the old first-page completion time from 1376.0 ms to 6482.8 ms, approximately **5.11 seconds**. The optimized zero-delay run was 867.7 ms; the final 100 ms run was 1044.7 ms, with **zero calls in both cases**. The difference reflects local execution variability, not central AUTH wait. The exact request scheduling and call count can change with delay: the zero-delay old gate made 87 calls on first load because fewer requests overlapped. These are single-run controlled measurements, not statistical confidence bounds.

## Cache conclusion

No cache policy was relaxed. Successful ETag responses retain `private, no-cache, max-age=0, must-revalidate`; other success responses retain `private, no-store, max-age=0`. The revisit obtains 304 responses for all 312 assets, proving the old bottleneck remained even when bodies were not downloaded again. Authentication ran before the 304. The new lease removes that repeated central round trip while retaining a gate check for each revalidation. Positive browser `max-age`, immutable caching and shared-cache authorization were not introduced. Fonts are covered by gate security tests; this performance fixture does not measure font loading.

## Reproduce

Run from the repository root (Git Bash examples):

```bash
BENCH_GATE_REF=18ef2aa1510e6d34314fc19744eb2d29e978da17 node packages/connect-cli/benchmark/authorization-lease.mjs docs/benchmarks/before-reproduced.json 100
BENCH_EXPIRED=1 node packages/connect-cli/benchmark/authorization-lease.mjs docs/benchmarks/after-reproduced.json 100
```

Use final argument `0` for the control with no deliberate delay. For actual Chrome, run the following in two terminals, then visit each port's `/bench/start` followed by `/bench/reload`. Wait for the visible JSON report after each navigation. Stop each process with Ctrl+C.

```bash
BENCH_BROWSER_PORT=18971 BENCH_GATE_REF=18ef2aa1510e6d34314fc19744eb2d29e978da17 node packages/connect-cli/benchmark/authorization-lease.mjs docs/benchmarks/browser-before.json 100
BENCH_BROWSER_PORT=18972 node packages/connect-cli/benchmark/authorization-lease.mjs docs/benchmarks/browser-after.json 100
```

The fixture's clock-advance route, HTTP adapter, fabricated identity and timing headers exist only in this benchmark process. None is added to the production runtime or generated installation output.

# vendor/

Upstream source snapshots and vendored assets used for offline reference.

| Path | Tracked? | Managed by |
|------|----------|------------|
| `metadata/` | Yes | Hand-maintained per-provider YAMLs (upstream URL, pinned commit SHA, license, adaptation notes) |
| `providers/` | No — gitignored | `scripts/vendor_providers.sh` clones each provider at a pinned SHA, strips `.git`, and records the SHA in `metadata/<name>.yaml` |
| `mem0/` | Yes | Hand-maintained embedded benchmark worker (`worker.py` + `VERSION`), used by the embedded mem0 transport |
| `memory-benchmarks/` | Yes | Committed benchmark harness snapshot |

To reconstruct `providers/` after a fresh clone:

```bash
bash scripts/vendor_providers.sh
```

See `docs/vendoring.md` for the full vendoring strategy and update workflow.
Note that some providers carry copyleft licenses (e.g. OpenViking is AGPL-3.0) —
they are cloned locally for reference only and must not be copied into this
repo's source.

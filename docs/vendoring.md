# Vendoring

## Strategy

This repo vendors upstream provider source code for offline review and reference. The goal is self-contained, auditable copies of the code patterns we intend to adapt.

## Approach

We use `scripts/vendor_providers.sh` to clone each provider at a pinned commit SHA with `--depth 1` (shallow clone), then remove the `.git` directory to produce a source snapshot. After cloning, the script writes the resolved SHA into `vendor/metadata/<name>.yaml`.

### Provider snapshots are not committed

All provider source snapshots under `vendor/providers/` are listed in `.gitignore` and cloned by the script — none are committed to this repo. Several of the repos are large (hundreds of MB to GB), and some have copyleft licenses (e.g. OpenViking is AGPL-3.0) that we do not want to redistribute. The script is reproducible: anyone can run it to reconstruct the full vendor directory offline.

**Cloned by script, not committed:**
- `mem0ai/mem0` — includes embeddings, Docker images, and UI assets
- `letta-ai/letta` — full agent framework with many dependencies
- `chroma-core/chroma` — full vector database server
- `emcie-co/parlant` — full conversation engine
- `topoteretes/cognee` — full knowledge pipeline
- `volcengine/OpenViking` — large retrieval framework (AGPL-3.0 — reference only)
- `google-gemini/gemini-cli` — full CLI tool with bundled assets
- `thedotmack/claude-mem` — small reference implementation
- `VectifyAI/PageIndex` — small document retrieval reference

Note: `vendor/mem0/` (embedded benchmark worker) and `vendor/memory-benchmarks/` (benchmark harness) are committed to this repo and are not managed by the vendor script.

### Metadata

Regardless of whether the source is committed, every provider has a metadata YAML file at `vendor/metadata/<name>.yaml`. This file documents the upstream URL, pinned commit, license, category, and what we intend to adapt. Metadata files are always committed.

## Reproducing the vendor directory

```bash
# Clone all providers at pinned commits
bash scripts/vendor_providers.sh

# Verify
ls vendor/providers/*/
```

The script is idempotent — it skips providers that are already cloned.

## Updating a provider

1. Update the pinned ref (4th field) in `scripts/vendor_providers.sh`
2. Update the corresponding `vendor/metadata/<name>.yaml` (the script refreshes `commit_sha` automatically on clone)
3. Delete the old vendor directory: `rm -rf vendor/providers/<category>/<name>`
4. Re-run: `bash scripts/vendor_providers.sh`

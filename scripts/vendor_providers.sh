#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR_DIR="$REPO_ROOT/vendor/providers"
METADATA_DIR="$REPO_ROOT/vendor/metadata"

# Each entry: category | name | repo URL | pinned ref (commit SHA or tag; empty = HEAD)
# Refs are "latest upstream HEAD at vendor time" — update as needed.
PROVIDERS=(
  "memory|mem0|https://github.com/mem0ai/mem0.git|f1791daa86d469249c9b002f62644d58a1eb96a0"
  "knowledge|claude-mem|https://github.com/thedotmack/claude-mem.git|68905ccd9f2fa4dc1131df94f9195266aee36053"
  "memory|letta|https://github.com/letta-ai/letta.git|8816d3a8516893bfdc0fa14bfb1235226012e295"
  "context|openviking|https://github.com/volcengine/OpenViking.git|b8e88959f3ab437b4d08514eceaa7221cca470dc"
  "knowledge|cognee|https://github.com/topoteretes/cognee.git|8853378eae5366addb064e758e560a456146ae1a"
  "routing|gemini-cli|https://github.com/google-gemini/gemini-cli.git|62bab5b232c15b925d31e655ce844ab939c882b7"
  "policy|parlant|https://github.com/emcie-co/parlant.git|a7b957ce88f594c1743a47dc1f567f8e7aaed9d9"
  "search|chroma|https://github.com/chroma-core/chroma.git|1a3ac2c7c623adbd03ed2508dc27b98cdf26016d"
  "search|pageindex|https://github.com/VectifyAI/PageIndex.git|2ac8694bf8fe89a3840dda9bdb88db5119b77fc4"
)

echo "=== agent-core vendor script ==="
echo "Vendor directory: $VENDOR_DIR"
echo ""

for entry in "${PROVIDERS[@]}"; do
  IFS='|' read -r category name repo_url ref <<< "$entry"
  target="$VENDOR_DIR/$category/$name"

  if [ -d "$target" ]; then
    echo "SKIP  $category/$name — already exists"
    continue
  fi

  echo "CLONE $category/$name from $repo_url @ ${ref:-HEAD}"
  mkdir -p "$(dirname "$target")"
  if [ -n "$ref" ]; then
    # Fetch the pinned ref directly (works for tags, branches, and full SHAs)
    git init -q "$target"
    git -C "$target" remote add origin "$repo_url"
    git -C "$target" fetch -q --depth 1 origin "$ref" 2>/dev/null || {
      echo "WARN  Failed to fetch $name@$ref — skipping"
      rm -rf "$target"
      continue
    }
    git -C "$target" checkout -q FETCH_HEAD
  else
    git clone --depth 1 "$repo_url" "$target" 2>/dev/null || {
      echo "WARN  Failed to clone $name — skipping"
      continue
    }
  fi

  # Record the resolved commit SHA before dropping .git
  sha="$(git -C "$target" rev-parse HEAD)"

  # Remove .git to make it a source snapshot
  rm -rf "$target/.git"

  # Write the pinned SHA into vendor/metadata/<name>.yaml
  if [ -f "$METADATA_DIR/$name.yaml" ]; then
    sed -i "s|^commit_sha:.*|commit_sha: $sha|" "$METADATA_DIR/$name.yaml"
  fi

  echo "  Pinned at $sha ($(date -u +%Y-%m-%dT%H:%M:%SZ))"
done

echo ""
echo "=== Done ==="
echo "Run 'ls vendor/providers/*/' to verify."

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

VERSION="$(npm pkg get version --workspaces=false | tr -d '"')"

echo "🚀 Linux release hazırlanıyor..."
if [[ "$DRY_RUN" == "true" ]]; then
  echo "ℹ️ Dry-run modu aktif."
fi
npm run build

mkdir -p release
PKG_FILE="$(npm pack --pack-destination release | tail -n 1)"
PKG_PATH="${ROOT_DIR}/release/${PKG_FILE}"

(
  cd release
  sha256sum "$PKG_FILE" > "${PKG_FILE}.sha256"
)

CHANGELOG_FILE="${ROOT_DIR}/release/CHANGELOG-${VERSION}.md"
LAST_TAG="$(git --no-pager describe --tags --abbrev=0 2>/dev/null || true)"
if [[ -n "$LAST_TAG" ]]; then
  COMMIT_RANGE="${LAST_TAG}..HEAD"
  RANGE_LABEL="Son etiket: ${LAST_TAG}"
else
  COMMIT_RANGE="HEAD"
  RANGE_LABEL="Son 20 commit"
fi
COMMITS="$(git --no-pager log --no-merges --pretty='- %h %s (%an)' ${COMMIT_RANGE} -n 20 2>/dev/null || true)"
if [[ -z "${COMMITS}" ]]; then
  COMMITS="- Commit özeti bulunamadı."
fi
cat > "$CHANGELOG_FILE" <<EOF
# SETH v${VERSION} — Release Özeti

- Tarih: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
- Mod: $([[ "$DRY_RUN" == "true" ]] && echo "dry-run" || echo "release")
- ${RANGE_LABEL}

## Commit Özeti

${COMMITS}
EOF

MANIFEST_FILE="${ROOT_DIR}/release/artifact-manifest-${VERSION}.json"
ARTIFACT_LIST="${PKG_PATH}"$'\n'"${PKG_PATH}.sha256"$'\n'"${CHANGELOG_FILE}"
export ROOT_DIR VERSION DRY_RUN MANIFEST_FILE ARTIFACT_LIST
node <<'NODE'
const fs = require('fs');
const crypto = require('crypto');

const root = process.env.ROOT_DIR;
const files = (process.env.ARTIFACT_LIST || '').split('\n').filter(Boolean);
const artifacts = files
  .filter((f) => fs.existsSync(f))
  .map((f) => ({
    path: f.startsWith(root + '/') ? f.slice(root.length + 1) : f,
    sizeBytes: fs.statSync(f).size,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'),
  }));

const manifest = {
  generatedAt: new Date().toISOString(),
  version: process.env.VERSION,
  dryRun: process.env.DRY_RUN === 'true',
  artifacts,
};

fs.writeFileSync(process.env.MANIFEST_FILE, JSON.stringify(manifest, null, 2), 'utf8');
NODE

echo "✅ Release paketi hazır: release/${PKG_FILE}"
echo "✅ Checksum hazır: release/${PKG_FILE}.sha256"
echo "✅ Changelog özeti: release/CHANGELOG-${VERSION}.md"
echo "✅ Artifact manifest: release/artifact-manifest-${VERSION}.json"
echo
echo "Kurulum (Linux):"
echo "  npm install -g ./release/${PKG_FILE}"
echo
echo "Doğrulama:"
echo "  sha256sum -c ./release/${PKG_FILE}.sha256"

#!/usr/bin/env bash
# Comprime y CIFRA un respaldo, y lo agrega a la carpeta de la rama `backups`,
# conservando solo los últimos KEEP archivos.
#
# Uso: BACKUP_PASSPHRASE=... encrypt-backup.sh <dir-exportado> <dir-rama> [KEEP]
#
# El repo es público: nada sale sin cifrar. La contraseña entra por stdin a gpg
# (no por argumentos, que serían visibles en la lista de procesos).
set -euo pipefail

EXPORT_DIR="$1"
BRANCH_DIR="$2"
KEEP="${3:-12}"

if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
  echo "ERROR: falta el secreto BACKUP_PASSPHRASE (Settings -> Secrets and variables -> Actions)." >&2
  exit 1
fi
if [ "${#BACKUP_PASSPHRASE}" -lt 20 ]; then
  echo "ERROR: BACKUP_PASSPHRASE debe tener al menos 20 caracteres." >&2
  exit 1
fi

STAMP="$(date -u +%Y-%m-%dT%H%MZ)"
NAME="respaldo-${STAMP}.tar.gz.gpg"
TMP_TAR="$(mktemp)"
trap 'rm -f "$TMP_TAR"' EXIT

tar -czf "$TMP_TAR" -C "$EXPORT_DIR" .
mkdir -p "$BRANCH_DIR"
printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --yes --quiet --pinentry-mode loopback \
  --passphrase-fd 0 --symmetric --cipher-algo AES256 --s2k-digest-algo SHA512 \
  --output "$BRANCH_DIR/$NAME" "$TMP_TAR"

# Rotación: conservar los KEEP más recientes (los nombres ordenan por fecha).
ls -1 "$BRANCH_DIR"/respaldo-*.tar.gz.gpg | sort | head -n "-$KEEP" | xargs -r rm -f

cat > "$BRANCH_DIR/README.md" <<'EOF'
# Respaldos cifrados de proclubs-stats

Generados cada semana por `.github/workflows/backup.yml`. Cada archivo es un
respaldo **completo** de la base, comprimido y cifrado con AES-256 (GPG simétrico).
Sin la contraseña (`BACKUP_PASSPHRASE`, guardada por el administrador) son ilegibles.
Se conservan los últimos 12.

## Restaurar

```bash
gpg --decrypt respaldo-AAAA-MM-DDTHHMMZ.tar.gz.gpg > respaldo.tar.gz
mkdir respaldo && tar -xzf respaldo.tar.gz -C respaldo
cd <repo>/collector && npm run restore-sql -- ../respaldo > restore.sql
```

Después: proyecto de Supabase con `supabase/migrations/*.sql` aplicadas y
ejecutar `restore.sql` en el SQL Editor (o con `psql`).
EOF

echo "Respaldo cifrado: $NAME ($(du -h "$BRANCH_DIR/$NAME" | cut -f1))"
ls -1 "$BRANCH_DIR"/respaldo-*.tar.gz.gpg | wc -l | xargs echo "Respaldos conservados:"

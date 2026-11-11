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

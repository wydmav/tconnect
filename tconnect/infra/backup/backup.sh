#!/bin/bash
set -e
STAMP=$(date -u +%F-%H%M)
mkdir -p /var/backups/tconnect
docker compose -f /opt/tconnect/docker-compose.yml exec -T postgres pg_dump -U tc_admin tconnect | gzip > /var/backups/tconnect/db-$STAMP.sql.gz
age -r "$BACKUP_AGE_PUBKEY" -o /var/backups/tconnect/db-$STAMP.sql.gz.age /var/backups/tconnect/db-$STAMP.sql.gz && rm /var/backups/tconnect/db-$STAMP.sql.gz
rclone copy /var/backups/tconnect/db-$STAMP.sql.gz.age "$BACKUP_REMOTE:tconnect/"
find /var/backups/tconnect -name '*.age' -mtime +30 -delete
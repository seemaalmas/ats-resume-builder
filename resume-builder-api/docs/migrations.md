# Migration errors & recovery

## Handling `P3018` (constraint rename already applied)

If a migration fails with `42601`/`P3018` while renaming a constraint (e.g., `ALTER TABLE "AppSetting" RENAME CONSTRAINT …`), follow these steps:

1. Inspect `pg_constraint` to see whether the new constraint already exists and the old constraint still lingers:
   ```sql
   SELECT conname FROM pg_constraint WHERE conrelid = 'AppSetting'::regclass;
   ```
2. If the database already has the finalized constraint names (e.g., `AppSetting_pkey`) and the migration chunk partially applied, drop/re-create the old constraint manually so the schema matches the migration or confirm the necessary changes are already in place.

### Development recovery

- Run `npx prisma migrate resolve --applied 20260219153726_restructure_app_setting`.
- Re-run `npx prisma migrate dev` so Prisma can re-apply remaining migrations cleanly.

### Production recovery

- After taking a backup, manually run the SQL that the migration defines (without syntax errors) to bring the schema to the expected state.
- Use `npx prisma migrate resolve --applied 20260219153726_restructure_app_setting` to inform Prisma that the migration is satisfied.

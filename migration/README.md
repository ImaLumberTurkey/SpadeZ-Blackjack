# Local Supabase CSV to Cloudflare D1 preparation

This tooling is local-only. It does not connect to Supabase or Cloudflare, and it does not run or deploy anything remotely.

## Place the backups

Create `migration/input/` in the project folder and place these four unchanged exports there:

- `catalog_items_rows.csv`
- `catalog_state_rows.csv`
- `admin_codes_rows.csv`
- `admin_pin_attempts_rows.csv`

The directory is ignored by Git. Generated SQL goes in the ignored `migration/output/` directory and contains admin PIN hashes and rate-limit fingerprints. The `migration/after-import/` directory for later D1 table exports is also ignored. Do not share or commit any of these files.

## Review and prepare

From the project root, run these local commands in PowerShell:

```powershell
python migration\import_supabase_csv.py --validate-only
python migration\import_supabase_csv.py
```

The first command validates the backups and tests the equivalent SQL against a temporary in-memory SQLite database without writing a file. The second repeats those checks and writes `migration/output/d1-import.sql`. The script prints table row counts only; it never prints row data, PIN hashes, or fingerprints.

The separate `d1-schema.sql` creates the tables and index without sample inserts. The generated import SQL contains only inserts for the four tables. JSON is parsed for validation but the original CSV JSON text is inserted unchanged. The script rejects malformed or duplicate rows, invalid JSON, inconsistent item IDs/sections, and all catalog item IDs used by the existing Supabase schema's sample seed.

D1 uses automatic commits and its batch API for transactions; explicit `BEGIN`/`COMMIT` statements are not included in the generated SQL. Do not start the import until the remote database is confirmed empty and both files have passed local validation. A failed remote file execution may leave partial writes; stop and inspect the database rather than rerunning the import blindly.

`admin_pin_attempts` history is included by default to preserve the current counters. To omit it as optional historical data, add `--omit-attempt-history`; this imports zero attempt rows and does not alter the required future rate limiter behavior. Do not remove the rate limit from the application: it must continue to atomically allow no more than 10 attempts per fingerprint in each 15-minute window. The schema retains the attempts table, but D1 does not support PostgreSQL functions; the runtime's rate-limit operation must be implemented as an atomic SQLite/D1 upsert with equivalent window logic before switching the application over.

The corresponding single-statement SQLite operation is:

```sql
INSERT INTO admin_pin_attempts (fingerprint, window_started_at, attempts)
VALUES (?1, ?2, 1)
ON CONFLICT (fingerprint) DO UPDATE SET
  window_started_at = CASE
    WHEN datetime(admin_pin_attempts.window_started_at) <= datetime(?2, '-15 minutes')
      THEN excluded.window_started_at
    ELSE admin_pin_attempts.window_started_at
  END,
  attempts = CASE
    WHEN datetime(admin_pin_attempts.window_started_at) <= datetime(?2, '-15 minutes')
      THEN 1
    ELSE admin_pin_attempts.attempts + 1
  END
RETURNING attempts <= 10 AS allowed;
```

## Admin PIN hash compatibility

Existing registry hashes are HMAC-SHA256 hex digests of each PIN using `PIN_PEPPER`. They are imported unchanged, but remain verifiable only if the new runtime uses the exact same pepper and hash input convention. The CSV does not contain the pepper. If the original `PIN_PEPPER` is unavailable, the imported hashes cannot be recovered or converted; arrange a controlled admin PIN reset instead. The environment-configured Super Admin PIN is not in `admin_codes` and must be configured separately in the new runtime. Never put PINs or the pepper in CSVs, generated SQL, logs, or source control.

## What to review before any D1 import

1. Confirm these are the intended, final exports and that the four headers match the original tables. No source CSV is modified.
2. Review the printed counts and successful validation, then inspect the generated SQL locally without copying its hash values elsewhere.
3. Confirm the sample-item rejection did not trigger. If it did, investigate the source backup and remove unwanted sample rows from a separate reviewed copy; never edit the original backups.
4. Confirm the original `PIN_PEPPER` is available to the planned runtime, or plan an admin PIN reset.
5. Review the optional attempt-history decision and verify the replacement runtime keeps the same 10-attempt/15-minute limit with an atomic D1 operation.
6. Confirm the D1 database is empty or that the import plan deliberately accounts for existing data. The script is intended for a new database; rerunning inserts into populated tables will fail rather than overwrite data.
7. After a later import, export all four D1 tables as CSVs with the same column names and place them in `migration/after-import/`. Run the local exact comparison against the original input backups:

   ```powershell
   python migration\import_supabase_csv.py --compare-dir migration\after-import
   ```

   This compares every row and column, including timestamps, hashes, fingerprints, and JSON values (without printing any cell values). It normalizes only SQLite's `catalog_state.id`/`seed_complete` booleans and parses JSON to compare its meaning. If attempt history was intentionally omitted, pass `--omit-attempt-history` here too. It fails on changed/missing/extra rows or values.

   You can also compare the table counts with the numbers printed during local validation and verify JSON validity:

   ```sql
   SELECT 'catalog_items' AS table_name, COUNT(*) AS row_count FROM catalog_items
   UNION ALL SELECT 'catalog_state', COUNT(*) FROM catalog_state
   UNION ALL SELECT 'admin_codes', COUNT(*) FROM admin_codes
   UNION ALL SELECT 'admin_pin_attempts', COUNT(*) FROM admin_pin_attempts;
   ```

   Verify JSON integrity and that no schema sample IDs were imported:

   ```sql
   SELECT COUNT(*) FROM catalog_items WHERE NOT json_valid(data);
   SELECT COUNT(*) FROM catalog_state
     WHERE NOT json_valid(section_config) OR NOT json_valid(theme_config);
   SELECT COUNT(*) FROM catalog_items
     WHERE id IN ('pc-royal-red', 'pc-midnight-black', 'pu-royal-swap', 'pu-vault-glow',
       'cur-coin', 'cur-bonus', 'jk-archivist', 'ace-crest', 'ft-thread', 'mg-fortune',
       'pr-ace-legend', 'ch-royal-dozen', 'tr-velvet');
   ```

   Each integrity and sample count must be zero. The export comparison is the stronger end-to-end integrity check.

No import command is run by this preparation step.

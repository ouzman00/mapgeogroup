"""Remove the local duplicate documents 0007 migration left by an overlay extraction.

Run from backend/ with:
    python scripts/cleanup_duplicate_documents_migration.py

The corrected project keeps only:
    documents/migrations/0007_rename_documents_p_source__a9c4f8_idx_documents_p_source_152700_idx.py
"""
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "documents" / "migrations"
OFFICIAL = "0007_rename_documents_p_source__a9c4f8_idx_documents_p_source_152700_idx.py"
DUPLICATE_SUFFIX = "_and_more.py"

removed = []
for path in MIGRATIONS_DIR.glob("0007_rename_documents_p_source__a9c4f8_idx_documents_p_source_152700_idx_and_more.py"):
    backup = path.with_suffix(path.suffix + ".bak")
    path.rename(backup)
    removed.append((path.name, backup.name))

if not (MIGRATIONS_DIR / OFFICIAL).exists():
    raise SystemExit(f"Official migration missing: {MIGRATIONS_DIR / OFFICIAL}")

if removed:
    for old, new in removed:
        print(f"Renamed duplicate migration {old} -> {new}")
else:
    print("No duplicate documents 0007 migration found.")

print("OK: keep only the official documents 0007 migration, then run: python manage.py migrate")

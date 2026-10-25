#!/usr/bin/env python3
"""Validate Supabase CSV backups and generate a transactional SQLite/D1 import."""

import argparse
import csv
import json
import sqlite3
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SCHEMA_PATH = ROOT / "d1-schema.sql"
DEFAULT_INPUT = ROOT / "input"
DEFAULT_OUTPUT = ROOT / "output" / "d1-import.sql"

TABLES = {
    "catalog_items": ("id", "section_key", "data", "created_at", "updated_at"),
    "catalog_state": ("id", "section_config", "logo_image", "theme_config", "seed_complete", "updated_at"),
    "admin_codes": ("id", "name", "pin_hash", "created_at"),
    "admin_pin_attempts": ("fingerprint", "window_started_at", "attempts"),
}

SAMPLE_ITEM_IDS = {
    "pc-royal-red",
    "pc-midnight-black",
    "pu-royal-swap",
    "pu-vault-glow",
    "cur-coin",
    "cur-bonus",
    "jk-archivist",
    "ace-crest",
    "ft-thread",
    "mg-fortune",
    "pr-ace-legend",
    "ch-royal-dozen",
    "tr-velvet",
}

JSON_COLUMNS = {
    "catalog_items": {"data"},
    "catalog_state": {"section_config", "theme_config"},
}

NON_NULL_COLUMNS = {
    "catalog_items": {"id", "section_key", "data", "created_at", "updated_at"},
    "catalog_state": {"id", "section_config", "theme_config", "seed_complete", "updated_at"},
    "admin_codes": {"id", "name", "pin_hash", "created_at"},
    "admin_pin_attempts": {"fingerprint", "window_started_at", "attempts"},
}


class ImportErrorDetail(Exception):
    """An input or generated-import validation error safe to display."""


def fail(message):
    raise ImportErrorDetail(message)


def read_csv(input_dir, table):
    path = input_dir / f"{table}_rows.csv"
    if not path.is_file():
        fail(f"Missing required backup file: {path.name}")

    rows = []
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as source:
            reader = csv.DictReader(source)
            if reader.fieldnames is None or len(reader.fieldnames) != len(set(reader.fieldnames)):
                fail(f"{path.name}: missing or duplicate CSV headers")
            expected = set(TABLES[table])
            if set(reader.fieldnames) != expected:
                fail(f"{path.name}: headers do not match the expected {table} columns")
            for line_number, row in enumerate(reader, start=2):
                if None in row:
                    fail(f"{path.name}:{line_number}: unexpected extra CSV field")
                if any(row[column] is None for column in TABLES[table]):
                    fail(f"{path.name}:{line_number}: missing CSV field")
                rows.append(row)
    except (OSError, UnicodeError, csv.Error) as error:
        fail(f"Could not read {path.name}: {error.__class__.__name__}")
    return rows


def validate_rows(rows_by_table):
    for table, rows in rows_by_table.items():
        columns = TABLES[table]
        primary_key = columns[0]
        seen = set()
        for index, row in enumerate(rows, start=2):
            key = row[primary_key]
            if not key:
                fail(f"{table}_rows.csv:{index}: empty primary key")
            if key in seen:
                fail(f"{table}_rows.csv:{index}: duplicate primary key")
            seen.add(key)

            for column in NON_NULL_COLUMNS[table]:
                if row[column] == "":
                    fail(f"{table}_rows.csv:{index}: empty required value in {column}")

            for column in JSON_COLUMNS.get(table, set()):
                try:
                    value = json.loads(row[column])
                except (json.JSONDecodeError, TypeError):
                    fail(f"{table}_rows.csv:{index}: invalid JSON in {column}")
                if not isinstance(value, dict):
                    fail(f"{table}_rows.csv:{index}: {column} must be a JSON object")

            if table == "catalog_items":
                if row["id"] in SAMPLE_ITEM_IDS:
                    fail(f"{table}_rows.csv:{index}: sample catalog item detected; review the source backup")
                item = json.loads(row["data"])
                if "id" in item and item["id"] != row["id"]:
                    fail(f"{table}_rows.csv:{index}: JSON item ID does not match its row ID")
                if "section" in item and item["section"] != row["section_key"]:
                    fail(f"{table}_rows.csv:{index}: JSON item section does not match its row section")
            elif table == "catalog_state":
                if row["id"].lower() not in {"true", "1"}:
                    fail("catalog_state_rows.csv: singleton id must be true")
                if row["seed_complete"].lower() not in {"true", "false", "0", "1"}:
                    fail("catalog_state_rows.csv: seed_complete must be a boolean")
            elif table == "admin_pin_attempts":
                try:
                    attempts = int(row["attempts"])
                except ValueError:
                    fail(f"{table}_rows.csv:{index}: attempts must be an integer")
                if attempts < 0:
                    fail(f"{table}_rows.csv:{index}: attempts must not be negative")

    if len(rows_by_table["catalog_state"]) != 1:
        fail("catalog_state_rows.csv: expected exactly one initialized singleton row")


def sql_literal(value):
    return "'" + value.replace("'", "''") + "'"


def sql_row(table, row):
    columns = TABLES[table]
    values = []
    for column in columns:
        value = row[column]
        if table == "catalog_state" and column == "id":
            value = "1"
        elif table == "catalog_state" and column == "seed_complete":
            value = "1" if value.lower() in {"true", "1"} else "0"
        elif table == "admin_pin_attempts" and column == "attempts":
            value = str(int(value))
        values.append(sql_literal(value))
    return (
        f"INSERT INTO {table} ({', '.join(columns)}) "
        f"VALUES ({', '.join(values)});"
    )


def build_sql(rows_by_table):
    statements = []
    for table in TABLES:
        statements.extend(sql_row(table, row) for row in rows_by_table[table])
    return "\n".join(statements) + ("\n" if statements else "")


def assert_database_matches(connection, rows_by_table):
    for table, rows in rows_by_table.items():
        actual_count = connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        if actual_count != len(rows):
            fail(f"Generated SQLite validation failed: {table} row count differs")

    for table, columns in JSON_COLUMNS.items():
        for row in rows_by_table[table]:
            key_column = TABLES[table][0]
            key = 1 if table == "catalog_state" else row[key_column]
            value = connection.execute(
                f"SELECT {', '.join(columns)} FROM {table} WHERE {key_column} = ?",
                (key,),
            ).fetchone()
            if value is None:
                fail(f"Generated SQLite validation failed: missing {table} row")
            for column, imported_json in zip(columns, value):
                if not connection.execute("SELECT json_valid(?)", (imported_json,)).fetchone()[0]:
                    fail(f"Generated SQLite validation failed: invalid JSON in {table}.{column}")
                if json.loads(imported_json) != json.loads(next(
                    row[column] for row in rows_by_table[table]
                    if (1 if table == "catalog_state" else row[key_column]) == key
                )):
                    fail(f"Generated SQLite validation failed: JSON changed in {table}.{column}")

    seed_ids = tuple(SAMPLE_ITEM_IDS)
    placeholders = ", ".join("?" for _ in seed_ids)
    sample_count = connection.execute(
        f"SELECT COUNT(*) FROM catalog_items WHERE id IN ({placeholders})",
        seed_ids,
    ).fetchone()[0]
    if sample_count:
        fail("Generated SQLite validation failed: sample catalog items detected")


def normalized_value(table, column, value):
    if table == "catalog_state" and column == "id":
        return "1"
    if table == "catalog_state" and column == "seed_complete":
        return "1" if value.lower() in {"true", "1"} else "0"
    if table == "admin_pin_attempts" and column == "attempts":
        return int(value)
    if column in JSON_COLUMNS.get(table, set()):
        return json.loads(value)
    return value


def compare_export(expected_by_table, export_dir):
    actual_by_table = {
        table: read_csv(export_dir, table)
        for table in TABLES
    }
    validate_rows(actual_by_table)

    for table, columns in TABLES.items():
        primary_key = columns[0]
        expected = {
            normalized_value(table, primary_key, row[primary_key]): row
            for row in expected_by_table[table]
        }
        actual = {
            normalized_value(table, primary_key, row[primary_key]): row
            for row in actual_by_table[table]
        }
        if expected.keys() != actual.keys():
            fail(f"Post-import export validation failed: {table} row IDs or count differ")
        for key, expected_row in expected.items():
            actual_row = actual[key]
            for column in columns:
                if normalized_value(table, column, expected_row[column]) != normalized_value(
                    table, column, actual_row[column]
                ):
                    fail(f"Post-import export validation failed: {table}.{column} differs")
    return {table: len(rows) for table, rows in actual_by_table.items()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--omit-attempt-history",
        action="store_true",
        help="exclude admin_pin_attempts historical counters (the table remains empty)",
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="validate CSVs and the generated import in local in-memory SQLite without writing SQL",
    )
    parser.add_argument(
        "--compare-dir",
        type=Path,
        help="compare CSV exports of the imported D1 tables against the original backups",
    )
    args = parser.parse_args()
    input_dir = args.input_dir.resolve()
    rows_by_table = {
        table: read_csv(input_dir, table)
        for table in TABLES
    }
    validate_rows(rows_by_table)
    if args.omit_attempt_history:
        rows_by_table["admin_pin_attempts"] = []

    sql = build_sql(rows_by_table)
    connection = sqlite3.connect(":memory:")
    try:
        connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        connection.executescript(sql)
        assert_database_matches(connection, rows_by_table)
    except sqlite3.Error as error:
        fail(f"Generated SQLite validation failed: {error.__class__.__name__}")
    finally:
        connection.close()

    counts = ", ".join(f"{table}={len(rows)}" for table, rows in rows_by_table.items())
    if args.compare_dir:
        actual_counts = compare_export(rows_by_table, args.compare_dir.resolve())
        if actual_counts != {table: len(rows) for table, rows in rows_by_table.items()}:
            fail("Post-import export validation failed: table row counts differ")
        print("Post-import export matches the source data; " + counts + ".")
        return
    if args.validate_only:
        print(f"Validation passed; row counts: {counts}. No SQL file was written.")
        return

    output = args.output.resolve()
    try:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(sql, encoding="utf-8", newline="")
    except OSError as error:
        fail(f"Could not write generated SQL: {error.__class__.__name__}")
    print(f"Validation passed; row counts: {counts}. SQL written to {output}.")


if __name__ == "__main__":
    try:
        main()
    except ImportErrorDetail as error:
        print(f"Import preparation failed: {error}", file=sys.stderr)
        sys.exit(1)

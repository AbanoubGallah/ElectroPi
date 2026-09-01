#!/usr/bin/env bash
# Executable check on the logic in 01_verify_item_in_electronics.sql.
#
# The shipped query is PostgreSQL; this harness re-runs the same joins in
# SQLite (available everywhere, no server needed) against four fixtures - one
# correct row and three realistic corruptions - to prove the assertions
# actually discriminate between them rather than just returning "no rows".
#
# Only the columns the assessment brief documents are used here, matching the
# shipped query. Dialect deltas vs PostgreSQL: CAST(... AS TEXT) and booleans
# rendering as 1/0.
#
# Usage: bash sql/validate_logic.sh
set -euo pipefail

DB="$(mktemp -t electropi-validate).db"
trap 'rm -f "$DB"' EXIT

sqlite3 "$DB" <<'SQL'
CREATE TABLE categories (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE products (
  id          TEXT PRIMARY KEY,
  item_name   TEXT NOT NULL,
  sku         TEXT NOT NULL UNIQUE,
  quantity    INTEGER NOT NULL,
  price       NUMERIC(12,2) NOT NULL,
  category_id INTEGER NOT NULL
);

INSERT INTO categories (id, name) VALUES (1, 'Groceries'), (3, 'Electronics');

-- Fixture 1: the correct row - every assertion must be true
INSERT INTO products VALUES ('11111111-1111-1111-1111-111111111111','Wireless Mouse','MS-001',50,25.00,3);
-- Fixture 2: right item, WRONG category (Groceries) -> assigned_to_electronics false
INSERT INTO products VALUES ('22222222-2222-2222-2222-222222222222','Wireless Mouse','MS-002',50,25.00,1);
-- Fixture 3: category_id resolves to nothing -> reference_resolves false, product still found
INSERT INTO products VALUES ('33333333-3333-3333-3333-333333333333','Wireless Mouse','MS-003',50,25.00,77);
-- Fixture 4 is the absence of a row (MS-999), tested below.
SQL

# QUERY B, parameterised by SKU, rendered for SQLite.
assertions_for() {
  sqlite3 -header -column "$DB" "
  WITH expected AS (
      SELECT '$1' AS sku, 'Electronics' AS category_name, 'Wireless Mouse' AS item_name,
             50 AS quantity, 25.00 AS price, 3 AS category_id
  ),
  actual AS (
      SELECT p.id, p.item_name, p.sku, p.quantity, p.price, p.category_id, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.sku = (SELECT sku FROM expected)
  )
  SELECT (SELECT COUNT(*) FROM actual) = 1 AS exactly_one_row,
         a.id IS NOT NULL                  AS product_exists,
         a.category_name IS NOT NULL       AS reference_resolves,
         a.category_name = e.category_name AS in_electronics,
         a.price = e.price                 AS price_matches
  FROM expected e LEFT JOIN actual a ON 1=1;"
}

for fixture in "MS-001:correct row - everything true" \
               "MS-002:wrong category (Groceries)" \
               "MS-003:category_id resolves to nothing" \
               "MS-999:never created"; do
  sku="${fixture%%:*}"; label="${fixture#*:}"
  printf '\n=== %s  [%s] ===\n' "$sku" "$label"
  assertions_for "$sku"
done

printf '\n=== QUERY C - referential integrity sweep (expected: MS-003 only) ===\n'
sqlite3 -header -column "$DB" "
SELECT p.sku, p.category_id FROM products p
LEFT JOIN categories c ON c.id = p.category_id
WHERE c.id IS NULL;"

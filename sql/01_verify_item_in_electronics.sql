-- ===========================================================================
-- Part 3.1 - Verify that the item created via POST /api/v1/inventory/items
--            was persisted and correctly assigned to the Electronics category.
--
-- Schema: the two tables named in the brief - `products` joined to
-- `categories`. The columns referenced are exactly those the brief documents:
-- the request payload fields (item_name, sku, quantity, price, category_id)
-- plus each table's own key and the category name. Nothing else is assumed.
--
-- Dialect: PostgreSQL. Parameters (:sku) are bound by the test runner, never
-- string-concatenated - injection-safe in test tooling, and plan-cacheable.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- QUERY A - the retrieval join (the direct answer)
--
-- INNER JOIN because the assertion is "this product IS in Electronics": if the
-- category reference does not resolve, the row must not come back.
--
-- Filtering on c.name rather than on p.category_id = 3 is deliberate. The API
-- was given category_id 3; asserting `category_id = 3` would only prove the
-- value we sent came back. Joining and checking the *name* proves the id
-- actually resolves to Electronics in the categories table, which is what
-- "correctly assigned" means.
-- ---------------------------------------------------------------------------
SELECT
    p.id,
    p.item_name,
    p.sku,
    p.quantity,
    p.price,
    p.category_id,
    c.name AS category_name
FROM products p
INNER JOIN categories c
        ON c.id = p.category_id
WHERE p.sku  = :sku
  AND c.name = 'Electronics';


-- ---------------------------------------------------------------------------
-- QUERY B - the assertion form (what the automated test actually runs)
--
-- Query A returns "no rows" for several different failures: the item was never
-- created, it was created against the wrong category, or its category_id does
-- not resolve at all. "No rows" is a poor test failure message.
--
-- This version always returns exactly ONE row of booleans, so the report names
-- the expectation that broke.
--
-- Two load-bearing details:
--   * LEFT JOIN to categories (unlike Query A), so a product whose category_id
--     points at nothing still comes back with category_name = NULL. That
--     separates "orphaned reference" from "never inserted".
--   * `expected LEFT JOIN actual`, so the expectations are always present and a
--     missing product yields product_exists = false rather than an empty result.
-- ---------------------------------------------------------------------------
WITH expected AS (
    SELECT
        CAST(:sku AS TEXT) AS sku,
        'Electronics'      AS category_name,
        'Wireless Mouse'   AS item_name,
        50                 AS quantity,
        CAST(25.00 AS NUMERIC(12,2)) AS price,
        3                  AS category_id
),
actual AS (
    SELECT
        p.id, p.item_name, p.sku, p.quantity, p.price, p.category_id,
        c.name AS category_name
    FROM products p
    LEFT JOIN categories c
           ON c.id = p.category_id
    WHERE p.sku = (SELECT sku FROM expected)
)
SELECT
    (SELECT COUNT(*) FROM actual) = 1 AS exactly_one_row,
    a.id IS NOT NULL                  AS product_exists,
    a.category_name IS NOT NULL       AS category_reference_resolves,
    a.category_name = e.category_name AS assigned_to_electronics,
    a.category_id   = e.category_id   AS category_id_as_submitted,
    a.item_name     = e.item_name      AS item_name_matches,
    a.quantity      = e.quantity       AS quantity_matches,
    a.price         = e.price          AS price_matches_exactly,
    -- actuals too, so a failing assertion needs no second round trip to diagnose
    a.id, a.item_name, a.quantity, a.price, a.category_id, a.category_name
FROM expected e
LEFT JOIN actual a ON TRUE;


-- ---------------------------------------------------------------------------
-- QUERY C - referential integrity sweep (nightly, not per test)
--
-- Inventory rows whose category_id does not resolve at all. Expected result:
-- zero rows. This is the class of corruption an API-level suite cannot see,
-- because the API happily returns the id it was given.
-- ---------------------------------------------------------------------------
SELECT p.id, p.sku, p.category_id
FROM products p
LEFT JOIN categories c
       ON c.id = p.category_id
WHERE c.id IS NULL;


-- ===========================================================================
-- Extensions for the real schema
--
-- The queries above use only the columns the brief documents. Three columns
-- are common in a platform like this one; each needs a one-line change, and
-- each is a real defect if it is present and ignored. I would confirm which
-- exist before the first run.
--
-- 1. MULTI-TENANCY (a tenant_id / store_id / merchant_id column)
--    This platform is multi-tenant, so this is the change I would check for
--    first. Add to every query:
--
--        INNER JOIN categories c ON c.id = p.category_id
--                               AND c.tenant_id = p.tenant_id
--        WHERE ... AND p.tenant_id = :tenant_id
--
--    The join condition matters as much as the filter: if categories are
--    tenant-scoped and the join is on category_id alone, it will happily
--    attach another merchant's category row - a bug that a single-tenant test
--    dataset never reveals. And a verification query that reads a shared table
--    untenanted can pass on another merchant's data.
--
--    It also enables the isolation check worth having on any multi-tenant
--    write path (expected result: zero rows):
--
--        SELECT p.id, p.tenant_id, p.sku FROM products p
--        WHERE p.sku = :sku AND p.tenant_id <> :tenant_id;
--
-- 2. SOFT DELETES (deleted_at / is_deleted / archived_at)
--    Add `AND p.deleted_at IS NULL`. Without it a "found" row may be one the
--    API already deleted; with it, a missing row is correctly reported as
--    absent rather than as never created.
--
-- 3. PRICE COLUMN TYPE
--    `price = 25.00` is an exact comparison and is only safe if price is
--    NUMERIC/DECIMAL. If it is FLOAT or DOUBLE, 25.00 can be stored as
--    24.999999999 and the assertion fails intermittently on a correct value;
--    compare with a tolerance instead:
--
--        ABS(p.price - 25.00) < 0.005
--
--    and raise storing money as NUMERIC(12,2) as a defect in its own right.
--
-- Porting notes
--   MySQL     : CAST(x AS TEXT) -> CAST(x AS CHAR); booleans render as 1/0.
--   Parameters: :name is JDBC/psycopg-style. Use %s (psycopg positional),
--               ? (JDBC/SQLite) or $1 (node-postgres) to match your driver.
-- ===========================================================================

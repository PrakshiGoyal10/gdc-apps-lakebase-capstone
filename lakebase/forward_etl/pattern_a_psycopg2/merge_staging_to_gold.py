# Databricks notebook source
# MAGIC %md
# MAGIC # Forward ETL — Lakebase staging -> Delta gold
# MAGIC
# MAGIC Pattern A: psycopg pulls unprocessed staging rows, Spark MERGEs them
# MAGIC into the gold Delta tables, then a single Postgres UPDATE flips
# MAGIC `processed = true` so re-runs are no-ops.
# MAGIC
# MAGIC Parameters (job widgets):
# MAGIC - `catalog`       — UC catalog containing the gold schema
# MAGIC - `pghost`        — Lakebase Postgres host
# MAGIC - `pgdatabase`    — Lakebase database
# MAGIC - `instance_name` — Lakebase instance name (for OAuth credential mint)

# COMMAND ----------

# MAGIC %pip install -q "psycopg[binary]"
# MAGIC dbutils.library.restartPython()

# COMMAND ----------

dbutils.widgets.text("catalog",       "")
dbutils.widgets.text("pghost",        "")
dbutils.widgets.text("pgdatabase",    "")
dbutils.widgets.text("instance_name", "")

CATALOG       = dbutils.widgets.get("catalog")
PG_HOST       = dbutils.widgets.get("pghost")
PG_DB         = dbutils.widgets.get("pgdatabase")
INSTANCE_NAME = dbutils.widgets.get("instance_name")

for name, val in [("catalog", CATALOG), ("pghost", PG_HOST),
                  ("pgdatabase", PG_DB), ("instance_name", INSTANCE_NAME)]:
    if not val:
        raise ValueError(f"Missing required widget value: {name}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Ensure gold target tables exist
# MAGIC
# MAGIC Self-bootstrapping CREATE TABLE IF NOT EXISTS — keeps the notebook
# MAGIC idempotent on a fresh workspace.

# COMMAND ----------

spark.sql(f"CREATE SCHEMA IF NOT EXISTS {CATALOG}.gold")

spark.sql(f"""
CREATE TABLE IF NOT EXISTS {CATALOG}.gold.customer_notes (
  id          BIGINT,
  customer_id STRING,
  note        STRING,
  author      STRING,
  created_at  TIMESTAMP,
  merged_at   TIMESTAMP
) USING DELTA
""")

spark.sql(f"""
CREATE TABLE IF NOT EXISTS {CATALOG}.gold.customer_segment_overrides (
  id             BIGINT,
  customer_id    STRING,
  new_segment_id STRING,
  reason         STRING,
  created_at     TIMESTAMP,
  merged_at      TIMESTAMP
) USING DELTA
""")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Mint a fresh Lakebase OAuth credential
# MAGIC
# MAGIC Same trick as the FastAPI backend's `db.py`. Token is ~1h-lived;
# MAGIC plenty for a single notebook run.

# COMMAND ----------

import json
import psycopg
from databricks.sdk import WorkspaceClient

w = WorkspaceClient()
cred = w.database.generate_database_credential(
    request_id="forward-etl",
    instance_names=[INSTANCE_NAME],
)
PG_USER  = w.current_user.me().user_name
PG_TOKEN = cred.token

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. Merge helper
# MAGIC
# MAGIC Read unprocessed staging rows -> Spark DataFrame -> MERGE INTO gold
# MAGIC -> mark processed in Lakebase. The Postgres UPDATE only runs after
# MAGIC the MERGE returns, so a Spark crash can't strand "processed but
# MAGIC not merged" rows.

# COMMAND ----------

from pyspark.sql import Row

def merge_table(
    *,
    staging_table: str,
    target_table:  str,
    columns:       list[str],
    schema_ddl:    str,
):
    select_cols = ", ".join(columns)
    fetch_sql = f"SELECT {select_cols} FROM public.{staging_table} WHERE processed = false"

    with psycopg.connect(
        host=PG_HOST, port=5432, dbname=PG_DB,
        user=PG_USER, password=PG_TOKEN, sslmode="require",
    ) as conn, conn.cursor() as cur:
        cur.execute(fetch_sql)
        rows = cur.fetchall()

        if not rows:
            print(f"[{staging_table}] nothing to merge")
            return 0

        ids = [r[0] for r in rows]
        spark_rows = [Row(**dict(zip(columns, r))) for r in rows]
        df = spark.createDataFrame(spark_rows, schema=schema_ddl)
        df.createOrReplaceTempView("staging_batch")

        non_key_cols = [c for c in columns if c not in ("id", "customer_id")]
        update_set   = ", ".join([f"t.{c} = s.{c}" for c in non_key_cols])
        insert_cols  = ", ".join(columns + ["merged_at"])
        insert_vals  = ", ".join([f"s.{c}" for c in columns] + ["current_timestamp()"])

        spark.sql(f"""
          MERGE INTO {CATALOG}.gold.{target_table} t
          USING staging_batch s ON t.id = s.id
          WHEN MATCHED THEN
            UPDATE SET {update_set}, t.merged_at = current_timestamp()
          WHEN NOT MATCHED THEN
            INSERT ({insert_cols}) VALUES ({insert_vals})
        """)

        cur.execute(
            f"UPDATE public.{staging_table} SET processed = true WHERE id = ANY(%s)",
            (ids,),
        )
        conn.commit()
        print(f"[{staging_table}] merged {len(rows)} -> {CATALOG}.gold.{target_table}")
        return len(rows)

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. Run merges

# COMMAND ----------

notes_n = merge_table(
    staging_table = "customer_notes_staging",
    target_table  = "customer_notes",
    columns       = ["id", "customer_id", "note", "author", "created_at"],
    schema_ddl    = "id long, customer_id string, note string, author string, created_at timestamp",
)

overrides_n = merge_table(
    staging_table = "customer_segment_overrides_staging",
    target_table  = "customer_segment_overrides",
    columns       = ["id", "customer_id", "new_segment_id", "reason", "created_at"],
    schema_ddl    = "id long, customer_id string, new_segment_id string, reason string, created_at timestamp",
)

# COMMAND ----------

dbutils.notebook.exit(json.dumps({
    "notes_merged":     notes_n,
    "overrides_merged": overrides_n,
}))

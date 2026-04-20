CREATE TABLE "retail_analytics"."crm"."CUSTOMER_PROFILE" (
  "customer_id" NUMBER NOT NULL,
  "email" VARCHAR NOT NULL UNIQUE,
  "phone_number" VARCHAR,
  "referrer_customer_id" NUMBER,
  "loyalty_tier" VARCHAR DEFAULT 'bronze' NOT NULL,
  "is_active" BOOLEAN DEFAULT TRUE NOT NULL,
  "created_at" TIMESTAMP_NTZ NOT NULL,
  "legacy_segment_code" VARCHAR,
  PRIMARY KEY ("customer_id"),
  CONSTRAINT "chk_customer_profile_loyalty_tier" CHECK (loyalty_tier in ('bronze','silver','gold','platinum'))
);

CREATE TABLE "retail_analytics"."master"."PRODUCT_CATALOG" (
  "product_id" NUMBER NOT NULL,
  "product_name" VARCHAR NOT NULL,
  "category" VARCHAR NOT NULL,
  "source_sku" VARCHAR UNIQUE,
  "list_price" DECIMAL(12,2) NOT NULL,
  "is_discontinued" BOOLEAN DEFAULT FALSE NOT NULL,
  "launched_on" DATE,
  PRIMARY KEY ("product_id"),
  CONSTRAINT "chk_product_catalog_list_price" CHECK (list_price >= 0)
);

CREATE TABLE "retail_analytics"."sales"."SALES_ORDER" (
  "order_id" NUMBER NOT NULL,
  "customer_id" NUMBER NOT NULL,
  "order_ts" TIMESTAMP_NTZ NOT NULL,
  "order_status" VARCHAR DEFAULT 'pending' NOT NULL,
  "channel" VARCHAR DEFAULT 'web' NOT NULL,
  "gross_amount" DECIMAL(12,2) NOT NULL,
  "discount_amount" DECIMAL(12,2) DEFAULT 0 NOT NULL,
  PRIMARY KEY ("order_id"),
  CONSTRAINT "chk_sales_order_order_status" CHECK (order_status in ('pending','paid','shipped','delivered','cancelled')),
  CONSTRAINT "chk_sales_order_gross_amount" CHECK (gross_amount >= 0),
  CONSTRAINT "chk_sales_order_discount_amount" CHECK (discount_amount >= 0)
);

CREATE TABLE "retail_analytics"."sales"."SALES_ORDER_LINE" (
  "line_id" NUMBER NOT NULL,
  "order_id" NUMBER NOT NULL,
  "product_id" NUMBER NOT NULL,
  "quantity" NUMBER NOT NULL,
  "unit_price" DECIMAL(12,2) NOT NULL,
  PRIMARY KEY ("line_id"),
  CONSTRAINT "chk_sales_order_line_quantity" CHECK (quantity > 0),
  CONSTRAINT "chk_sales_order_line_unit_price" CHECK (unit_price >= 0)
);

CREATE TABLE "retail_analytics"."finance"."PAYMENT_EVENT" (
  "payment_event_id" NUMBER NOT NULL,
  "order_id" NUMBER NOT NULL,
  "payment_method" VARCHAR NOT NULL,
  "payment_status" VARCHAR DEFAULT 'pending' NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "processed_at" TIMESTAMP_NTZ,
  PRIMARY KEY ("payment_event_id"),
  CONSTRAINT "chk_payment_event_payment_status" CHECK (payment_status in ('pending','authorized','captured','failed','refunded')),
  CONSTRAINT "chk_payment_event_amount" CHECK (amount >= 0)
);

CREATE TABLE "retail_analytics"."supply"."PRODUCT_SUPPLIER_BRIDGE" (
  "bridge_id" NUMBER NOT NULL,
  "product_id" NUMBER NOT NULL,
  "supplier_sku" VARCHAR NOT NULL,
  "lead_time_days" NUMBER NOT NULL,
  PRIMARY KEY ("bridge_id"),
  CONSTRAINT "chk_product_supplier_bridge_lead_time_days" CHECK (lead_time_days >= 0)
);

CREATE MATERIALIZED VIEW "retail_analytics"."analytics"."ORDER_FULFILLMENT_MV" AS
SELECT NULL AS "order_id", NULL AS "fulfillment_stage", NULL AS "warehouse", NULL AS "last_event_ts";

CREATE VIEW "retail_analytics"."analytics"."HIGH_VALUE_CUSTOMER_VIEW" AS
SELECT NULL AS "customer_id", NULL AS "lifetime_value", NULL AS "last_order_ts";

ALTER TABLE "retail_analytics"."sales"."SALES_ORDER" ADD CONSTRAINT "fk_customer_orders" FOREIGN KEY ("customer_id") REFERENCES "retail_analytics"."crm"."CUSTOMER_PROFILE" ("customer_id");

ALTER TABLE "retail_analytics"."crm"."CUSTOMER_PROFILE" ADD CONSTRAINT "fk_customer_referrals" FOREIGN KEY ("referrer_customer_id") REFERENCES "retail_analytics"."crm"."CUSTOMER_PROFILE" ("customer_id");

ALTER TABLE "retail_analytics"."sales"."SALES_ORDER_LINE" ADD CONSTRAINT "fk_order_lines" FOREIGN KEY ("order_id") REFERENCES "retail_analytics"."sales"."SALES_ORDER" ("order_id");

ALTER TABLE "retail_analytics"."sales"."SALES_ORDER_LINE" ADD CONSTRAINT "fk_line_products" FOREIGN KEY ("product_id") REFERENCES "retail_analytics"."master"."PRODUCT_CATALOG" ("product_id");

ALTER TABLE "retail_analytics"."finance"."PAYMENT_EVENT" ADD CONSTRAINT "fk_order_payments" FOREIGN KEY ("order_id") REFERENCES "retail_analytics"."sales"."SALES_ORDER" ("order_id");

ALTER TABLE "retail_analytics"."supply"."PRODUCT_SUPPLIER_BRIDGE" ADD CONSTRAINT "fk_bridge_products" FOREIGN KEY ("product_id") REFERENCES "retail_analytics"."master"."PRODUCT_CATALOG" ("product_id");

ALTER TABLE "retail_analytics"."supply"."PRODUCT_SUPPLIER_BRIDGE" ADD CONSTRAINT "fk_bridge_suppliers" FOREIGN KEY ("supplier_sku") REFERENCES "retail_analytics"."ingestion"."SUPPLIER_FEED" ("supplier_sku");

ALTER TABLE "retail_analytics"."analytics"."ORDER_FULFILLMENT_MV" ADD CONSTRAINT "fk_fulfillment_order" FOREIGN KEY ("order_id") REFERENCES "retail_analytics"."sales"."SALES_ORDER" ("order_id");

ALTER TABLE "retail_analytics"."analytics"."DAILY_REVENUE_SNAPSHOT" ADD CONSTRAINT "fk_snapshot_order" FOREIGN KEY ("order_id") REFERENCES "retail_analytics"."sales"."SALES_ORDER" ("order_id");

ALTER TABLE "retail_analytics"."analytics"."HIGH_VALUE_CUSTOMER_VIEW" ADD CONSTRAINT "fk_high_value_customer" FOREIGN KEY ("customer_id") REFERENCES "retail_analytics"."crm"."CUSTOMER_PROFILE" ("customer_id");

CREATE INDEX "ix_sales_order_customer_ts" ON "retail_analytics"."sales"."SALES_ORDER" ("customer_id", "order_ts");

CREATE INDEX "ix_sales_order_status" ON "retail_analytics"."sales"."SALES_ORDER" ("order_status");

CREATE INDEX "ix_sales_order_line_order_product" ON "retail_analytics"."sales"."SALES_ORDER_LINE" ("order_id", "product_id");

CREATE UNIQUE INDEX "ux_product_catalog_source_sku" ON "retail_analytics"."master"."PRODUCT_CATALOG" ("source_sku");

CREATE UNIQUE INDEX "ux_product_supplier_bridge" ON "retail_analytics"."supply"."PRODUCT_SUPPLIER_BRIDGE" ("product_id", "supplier_sku");

CREATE INDEX "ix_payment_event_status" ON "retail_analytics"."finance"."PAYMENT_EVENT" ("payment_status", "processed_at");

CREATE INDEX "ix_daily_revenue_snapshot_date" ON "retail_analytics"."analytics"."DAILY_REVENUE_SNAPSHOT" ("snapshot_date");

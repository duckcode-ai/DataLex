# jaffle-shop fixture

Bundled "Load demo" dataset for the **Import dbt repo** dialog.

These YAML files were produced by running `dm dbt import` against
[dbt-labs/jaffle-shop](https://github.com/dbt-labs/jaffle-shop) and are
checked in so the demo loads instantly without a network round-trip.

## Regenerating

```bash
cd /path/to/jaffle-shop
dbt deps
dbt parse                  # writes target/manifest.json

dm dbt import \
    --project-dir /path/to/jaffle-shop \
    --out packages/web-app/src/fixtures/jaffle-shop \
    --skip-warehouse
```

## Shape

Folder layout mirrors the dbt repo (`models/staging/jaffle_shop/`,
`models/marts/`, `models/metrics/`). Each file is DataLex-shaped
(`kind: model`, `columns: [...]`, `meta.datalex.dbt.unique_id`) so the
Explorer / canvas / right panel all render as they would for a real
project.

`--skip-warehouse` intentionally leaves columns without `data_type`, which
is the default for dbt users who haven't configured a warehouse — this
also exercises the dbt lint rules (missing type / missing tests) so the
demo showcases validation alongside the tree render.

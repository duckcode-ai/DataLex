# Tutorials

These tutorials are intentionally short and sequential. They teach the product
workflow on any dbt repo and avoid embedding example-specific fixtures in the
DataLex repo.

Screenshots use DataLex's light **Paper** theme where a visual step is useful.

1. [Install and run DataLex](01-install-and-run.md)
2. [Connect an existing dbt repo](02-connect-existing-dbt.md)
3. [Configure AI with OpenAI, Claude, or Ollama](03-configure-ai.md)
4. [Generate, review, and certify a proposal pack](04-generate-review-certify.md)
5. [Publish the DataLex manifest](05-publish-manifest.md)
6. [Run DataLex with Docker](06-docker.md)

Use your own dbt repo for the main path. For a disposable test, use any local
dbt repo and run `dbt parse` before connecting it.

## End-to-end Example

For the canonical DataLex + DQL OSS story, use the separate
[`duckcode-ai/jaffle-shop-duckdb`](https://github.com/duckcode-ai/jaffle-shop-duckdb)
repo. It contains the dbt project, DataLex contracts, DQL blocks, screenshots,
and video storyboard in one place:

- [Jaffle Shop tutorial](https://github.com/duckcode-ai/jaffle-shop-duckdb/blob/main/docs/tutorials/jaffle/README.md)

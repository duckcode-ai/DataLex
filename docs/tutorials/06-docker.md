# 6. Run DataLex with Docker

Docker is optional. Use it when local Python or Node setup is blocked.

## Build the image

```bash
git clone https://github.com/duckcode-ai/DataLex.git
cd DataLex
docker build -t datalex:local .
```

## Run the app

```bash
docker run --rm -p 3030:3001 datalex:local
```

Open:

```text
http://localhost:3030
```

## Run against an existing dbt repo

```bash
cd ~/path/to/your-dbt-project
docker run --rm -p 3030:3001 \
  -v "$PWD":/workspace \
  -e REPO_ROOT=/workspace \
  -e DM_CLI=/app/datalex \
  datalex:local
```

In the UI, choose:

```text
/workspace
```

as the dbt project path.

## Notes

- AI provider keys should still be configured through the UI or environment.
- Ollama must be reachable from the container if you use a local model.
- Generated DataLex files are written back to the mounted dbt repo.

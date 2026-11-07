# AI Agent Access

Coding agents can consume Honovel's documentation directly while helping you build a Honovel application. Paths below are relative to the documentation base URL. For the GitHub Pages project site, that base is `https://honovel.github.io/framework/`, so the index is `https://honovel.github.io/framework/llms.txt`.

## Documentation index

Use:

```text
llms.txt
```

It provides a compact index of available topics and their machine-readable versions. This is the recommended starting point for most agents.

## Complete documentation

Use:

```text
llms-full.txt
```

when an agent should load the entire Honovel documentation corpus in one request.

## Individual topics

Each topic is available under `raw/`:

```text
raw/controllers.md
raw/dependency-injection.md
raw/database.md
raw/events-queues.md
raw/openapi.md
```

An agent working on persistence can load the database page, while one working on authorization can load the authentication and custom-decorator pages.

## Suggested project instruction

```text
When working on Honovel-specific code, consult the framework documentation at llms.txt and load the relevant raw documentation pages before implementing framework APIs.
```

This helps prevent agents from assuming APIs from other frameworks or plain Hono that do not exist in Honovel.

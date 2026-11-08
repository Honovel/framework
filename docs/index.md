---
layout: home
hero:
  name: Honovel
  text: Structured APIs for Cloudflare
  image:
    src: /honovel-icon.png
    alt: Honovel
  tagline: Build structured Hono applications with controllers, validation, dependency injection, Drizzle, queues, scheduling and OpenAPI.
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: Project Structure
      link: /project-structure
features:
  - title: Productive application structure
    details: Controllers, FormRequests, repositories, actions, middleware and dependency injection give larger Hono applications a consistent shape.
  - title: Compile-time safety
    details: Routes, dependency bindings and framework diagnostics are validated before your application is deployed.
  - title: Cloudflare ready
    details: Create a Cloudflare Workers API with D1, Durable Object cache, queues and cron; optionally include a Nuxt frontend.
---

# Honovel

Honovel is a TypeScript application framework built on top of Hono. It adds structure and conventions for applications that need more than a minimal HTTP router while keeping Hono's portability.

A Honovel application can use controllers and typed route parameters, FormRequest validation, dependency injection, middleware and authentication, custom decorators, Drizzle database providers and migrations, cache and atomic locks, events and queued work, cron jobs, custom JSON error contracts, generated OpenAPI/Swagger documentation and CLI generators. See [Exceptions & Debugging](/exceptions#custom-error-schemas) to use one error schema in runtime responses and generated API documentation.

## Creating an application

Start a new application with:

```bash
npm create honovel@latest my-app
```

The installer creates a Cloudflare Workers backend and lets you choose a Nuxt frontend or API-only setup. It uses `create-honovel` from the public npm registry. The source repository is [Honovel/framework on GitHub](https://github.com/Honovel/framework); you do not need to clone it. See [Getting Started](/getting-started) for setup and requirements.

With Nuxt:

```bash
npm create honovel@latest my-app -- --frontend=nuxt
```

API-only:

```bash
npm create honovel@latest my-app -- --api-only
```

Continue with [Getting Started](/getting-started).

import type { Hono } from 'hono'
import { honovelIconDataUrl } from '../http/branding.js'

export interface OpenApiRouteSettings {
  swaggerPath: string
  openApiPath: string
}

function routePath(value: string, fallback: string): string {
  const trimmed = value.trim()
  if (!trimmed) return fallback
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function swaggerHtml(title: string, specPath: string): string {
  const encodedSpecPath = JSON.stringify(specPath).replaceAll('</', '<\\/')
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} API</title>
  <link rel="icon" type="image/png" href="${honovelIconDataUrl}" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: ${encodedSpecPath},
      dom_id: '#swagger-ui',
      deepLinking: true,
      displayRequestDuration: true,
    })
  </script>
</body>
</html>`
}

export function registerOpenApiRoutes(
  app: Hono<any, any, any>,
  document: Record<string, unknown>,
  settings: OpenApiRouteSettings,
): void {
  const swaggerPath = routePath(settings.swaggerPath, '/swagger')
  const specPath = routePath(settings.openApiPath, '/openapi.json')
  const info = document.info as Record<string, unknown> | undefined
  const title = typeof info?.title === 'string' ? info.title : 'Honovel'

  app.get(specPath, (context) => context.json(document as never))
  app.get(swaggerPath, (context) => context.html(swaggerHtml(title, specPath)))
}

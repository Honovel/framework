import { defineConfig } from 'vitepress'
import { docsBase, githubPages, assetPath } from '../scripts/site-config.mjs'

export default defineConfig({
  title: 'Honovel',
  description: 'TypeScript application framework for Hono and Cloudflare Workers.',
  base: docsBase,
  cleanUrls: !githubPages,
  lastUpdated: true,
  srcExclude: ['publishing.md', 'public/**/*.md'],
  head: [
    ['link', { rel: 'icon', type: 'image/png', href: assetPath('honovel-icon.png') }],
    ['meta', { name: 'theme-color', content: '#7c5cff' }],
    ['link', { rel: 'alternate', type: 'text/plain', href: assetPath('llms.txt'), title: 'Honovel documentation for AI agents' }],
  ],
  themeConfig: {
    siteTitle: 'Honovel',
    logo: { src: '/honovel-icon.png', alt: 'Honovel' },
    search: { provider: 'local' },
    nav: [
      { text: 'Guide', link: '/getting-started' },
      { text: 'HTTP', link: '/controllers' },
      { text: 'Application', link: '/dependency-injection' },
      { text: 'AI Agents', link: '/agents' },
    ],
    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Introduction', link: '/' },
          { text: 'Getting Started', link: '/getting-started' },
          { text: 'Project Structure', link: '/project-structure' },
          { text: 'Frontend', link: '/frontend' },
          { text: 'OpenAPI & Swagger', link: '/openapi' },
          { text: 'Development & Compiler', link: '/compiler' },
        ],
      },
      {
        text: 'HTTP',
        items: [
          { text: 'Controllers & Routing', link: '/controllers' },
          { text: 'Requests & Validation', link: '/requests' },
          { text: 'Middleware', link: '/middleware' },
          { text: 'Logging & Request Context', link: '/logging' },
          { text: 'Authentication', link: '/authentication' },
          { text: 'Exceptions & Debugging', link: '/exceptions' },
          { text: 'Custom Decorators', link: '/custom-decorators' },
        ],
      },
      {
        text: 'Application',
        items: [
          { text: 'Dependency Injection', link: '/dependency-injection' },
          { text: 'Database', link: '/database' },
          { text: 'Cache', link: '/cache' },
          { text: 'Locks', link: '/locks' },
          { text: 'Events & Queues', link: '/events-queues' },
          { text: 'Cron Jobs', link: '/cron' },
        ],
      },
      {
        text: 'Tooling & Deployment',
        items: [
          { text: 'CLI', link: '/cli' },
          { text: 'Runtime & Deployment', link: '/deployment' },
          { text: 'AI Agent Access', link: '/agents' },
        ],
      },
    ],
    outline: { level: [2, 3], label: 'On this page' },
    footer: { copyright: 'Honovel' },
  },
})

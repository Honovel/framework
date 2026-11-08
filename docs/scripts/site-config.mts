// Shared by VitePress and generated agent documents so every published URL uses
// the same mount point. Root deployments remain available for local/Cloudflare use.
const configuredBase = process.env.HONOVEL_DOCS_BASE ?? '/'
if (!/^\/[A-Za-z0-9_./-]*$/.test(configuredBase) || configuredBase.split('/').includes('..')) {
  throw new Error('HONOVEL_DOCS_BASE must be an absolute site path such as /framework/.')
}
const trimmedBase = configuredBase.replace(/^\/+|\/+$/g, '')
export const docsBase = trimmedBase ? `/${trimmedBase}/` : '/'
export const githubPages = process.env.HONOVEL_DOCS_TARGET === 'github-pages'

export function assetPath(value) {
  return docsBase + value.replace(/^\/+/, '')
}

export function pagePath(value) {
  const [pathname, ...fragment] = value.split('#')
  const suffix = githubPages && pathname !== '/' && !/\.[a-z0-9]+$/i.test(pathname) ? '.html' : ''
  return assetPath(pathname + suffix) + (fragment.length ? `#${fragment.join('#')}` : '')
}

export function rewriteDocLinks(markdown) {
  return markdown.replace(/(\]\()\/(?!\/)([^)\s]*)(\))/g, (_match, before, target, after) => {
    const link = target.startsWith('raw/') || target.startsWith('llms')
      ? assetPath(target) : pagePath('/' + target)
    return before + link + after
  })
}

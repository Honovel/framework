import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assetPath, pagePath, rewriteDocLinks } from './site-config.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pub = path.join(root, 'public')
const raw = path.join(pub, 'raw')
const ignoredDirectories = new Set(['.vitepress', 'node_modules', 'public', 'scripts'])
const ignoredFiles = new Set(['publishing.md'])

async function collect(dir, rel = '') {
  const out: string[] = []

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || ignoredDirectories.has(entry.name)) continue

    const absolute = path.join(dir, entry.name)
    const relative = path.join(rel, entry.name)

    if (entry.isDirectory()) {
      out.push(...await collect(absolute, relative))
    } else if (entry.isFile() && entry.name.endsWith('.md') && !ignoredFiles.has(relative.split(path.sep).join('/'))) {
      out.push(relative)
    }
  }

  return out.sort()
}

const route = (file) => {
  const normalized = file.split(path.sep).join('/')
  return pagePath(normalized === 'index.md' ? '/' : `/${normalized.replace(/\.md$/, '')}`)
}

const title = (markdown, file) => markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? file

await rm(raw, { recursive: true, force: true })
await mkdir(raw, { recursive: true })

const docs: Array<{ file: string; markdown: string; title: string; route: string }> = []

for (const file of await collect(root)) {
  const source = path.join(root, file)
  const destination = path.join(raw, file)
  await mkdir(path.dirname(destination), { recursive: true })
  const markdown = rewriteDocLinks(await readFile(source, 'utf8'))
  await writeFile(destination, markdown)
  docs.push({ file: file.split(path.sep).join('/'), markdown, title: title(markdown, file), route: route(file) })
}

const llms = [
  '# Honovel',
  '',
  '> Documentation for building applications with Honovel.',
  '',
  '## Documentation',
  '',
  ...docs.map((doc) => `- [${doc.title}](${doc.route}): [Markdown](${assetPath(`raw/${doc.file}`)})`),
  '',
  '## Full documentation',
  '',
  `- [All documentation in one document](${assetPath('llms-full.txt')})`,
  '',
].join('\n')

const full = docs.flatMap((doc) => [
  `# ${doc.title}`,
  '',
  `Source: ${doc.route}`,
  '',
  doc.markdown.replace(/^#\s+.+$/m, '').trim(),
  '',
  '---',
  '',
]).join('\n')

await mkdir(pub, { recursive: true })
await writeFile(path.join(pub, 'llms.txt'), llms)
await writeFile(path.join(pub, 'llms-full.txt'), full)
console.log(`[Honovel Docs] Generated ${docs.length} agent-readable documents.`)

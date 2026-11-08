import type ts from 'typescript/lib/tsserverlibrary'
import diagnostics = require('./diagnostics.cjs')
const { collectHonovelDiagnostics } = diagnostics

function init(modules: { typescript: typeof ts }) {
  const ts = modules.typescript

  function create(info: ts.server.PluginCreateInfo): ts.LanguageService {
    const languageService = info.languageService
    const proxy: ts.LanguageService = Object.create(null)

    for (const key of Object.keys(languageService) as Array<keyof ts.LanguageService>) {
      const method = languageService[key]
      if (typeof method === 'function') {
        Reflect.set(proxy, key, (...args: unknown[]) => Reflect.apply(method, languageService, args))
      }
    }

    proxy.getSemanticDiagnostics = (fileName) => {
      const existing = languageService.getSemanticDiagnostics(fileName)
      const program = languageService.getProgram()

      if (!program) return existing

      const sourceFile = program.getSourceFile(fileName)
      if (!sourceFile) return existing

      return [
        ...existing,
        ...collectHonovelDiagnostics(ts, program, sourceFile),
      ]
    }

    info.project.projectService.logger.info(
      '[Honovel] TypeScript language service plugin loaded.',
    )

    return proxy
  }

  return { create }
}

export = Object.assign(init, { collectHonovelDiagnostics })

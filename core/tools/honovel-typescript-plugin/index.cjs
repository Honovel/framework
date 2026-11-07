const { collectHonovelDiagnostics } = require('./diagnostics.cjs')

function init(modules) {
  const ts = modules.typescript

  function create(info) {
    const languageService = info.languageService
    const proxy = Object.create(null)

    for (const key of Object.keys(languageService)) {
      const method = languageService[key]
      proxy[key] = (...args) => method.apply(languageService, args)
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

module.exports = init
module.exports.collectHonovelDiagnostics = collectHonovelDiagnostics

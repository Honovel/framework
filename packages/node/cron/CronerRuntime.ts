import { Cron as Croner } from 'croner'

export type HonovelCronRuntime = {
  cronSchedules?: readonly string[]
  runCronJob?: (
    cron: string,
    bindings?: unknown,
    executionCtx?: unknown,
  ) => Promise<void>
}

export type StartCronJobsOptions = {
  bindings?: unknown
  onError?: (error: unknown, cron: string) => void
}

/**
 * Start all compiler-discovered Honovel CronJobs with Croner.
 *
 * Each running Node process owns its own timers. Applications with multiple
 * replicas should add distributed coordination before relying on exactly-once execution.
 */
export function startCronJobs<TApp extends object>(
  app: TApp,
  options: StartCronJobsOptions = {},
): Array<Croner> {
  const runtime = app as TApp & HonovelCronRuntime
  const schedules = runtime.cronSchedules ?? []
  if (schedules.length === 0) return []
  if (!runtime.runCronJob) {
    throw new Error('Honovel cron schedules are present but runCronJob() is not registered on the application.')
  }

  return schedules.map((cron) => new Croner(cron, async () => {
    try {
      await runtime.runCronJob?.(cron, options.bindings ?? {})
    } catch (error) {
      if (options.onError) {
        options.onError(error, cron)
        return
      }
      console.error(`[Honovel] CronJob failed for ${cron}.`, error)
    }
  }))
}

export abstract class CronJob {
  abstract handle(): Promise<void> | void
}

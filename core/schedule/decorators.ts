export type CronFieldValue = number | string | readonly (number | string)[]

export interface CronOptions {
  minute?: CronFieldValue
  hour?: CronFieldValue
  day?: CronFieldValue
  month?: CronFieldValue
  weekday?: CronFieldValue
}

/**
 * Declare the static schedule for a CronJob.
 *
 * Honovel consumes this decorator at compile time and removes it from emitted code.
 * Missing fields compile to `*`. Cloudflare Cron Triggers execute in UTC and have
 * minute-level precision.
 */
export const Cron = (_options: CronOptions): ClassDecorator => () => undefined

# Cron Jobs

Cron jobs run recurring application work using `CronJob` and compile-time `@Cron()` metadata. Honovel turns the decorator into a normal five-field cron expression in this order:

```text
minute hour day month weekday
```

Fields that you omit become `*`.

## Create a cron job

```ts
@Cron({
  minute: 30,
  hour: 8,
  weekday: 'MON-FRI',
})
export class SendMorningReminders extends CronJob {
  async handle() {
    console.log('Sending reminders')
  }
}
```

This compiles to a schedule equivalent to:

```text
30 8 * * MON-FRI
```

## Supported fields

`@Cron()` supports exactly these fields:

| Field | Numeric range | Meaning |
| --- | ---: | --- |
| `minute` | `0-59` | Minute of the hour |
| `hour` | `0-23` | Hour of the day |
| `day` | `1-31` | Day of the month |
| `month` | `1-12` | Month |
| `weekday` | `0-7` | Day of the week |

Each field accepts:

- a number;
- a cron-field string;
- an array of numbers and/or cron-field strings.

Numeric values are range-checked by Honovel during compilation. String expressions are passed through as cron-field expressions and must be supported by the selected runtime.

## Every minute

An empty options object means every field is `*`:

```ts
@Cron({})
export class RunEveryMinute extends CronJob {}
```

Equivalent expression:

```text
* * * * *
```

## Every N minutes

Use a step expression:

```ts
@Cron({ minute: '*/5' })
export class RunEveryFiveMinutes extends CronJob {}
```

## Every hour

Run at the beginning of every hour:

```ts
@Cron({ minute: 0 })
export class RunHourly extends CronJob {}
```

Equivalent expression:

```text
0 * * * *
```

## Daily at a specific time

```ts
@Cron({
  hour: 2,
  minute: 30,
})
export class RunDailyAtTwoThirty extends CronJob {}
```

## Several times per day

Arrays compile to comma-separated values:

```ts
@Cron({
  minute: 0,
  hour: [8, 12, 18],
})
export class SyncThreeTimesDaily extends CronJob {}
```

Equivalent expression:

```text
0 8,12,18 * * *
```

## Weekdays

Use a cron range:

```ts
@Cron({
  hour: 8,
  minute: 30,
  weekday: 'MON-FRI',
})
export class WeekdayMorningJob extends CronJob {}
```

You can also use numeric weekday values or arrays:

```ts
@Cron({
  hour: 10,
  minute: 0,
  weekday: [1, 3, 5],
})
export class MondayWednesdayFridayJob extends CronJob {}
```

## Specific days of the month

```ts
@Cron({
  day: 1,
  hour: 0,
  minute: 15,
})
export class FirstDayOfMonth extends CronJob {}
```

Run on several days:

```ts
@Cron({
  day: [1, 15],
  hour: 6,
  minute: 0,
})
export class TwiceMonthly extends CronJob {}
```

## Specific months

```ts
@Cron({
  month: [1, 4, 7, 10],
  day: 1,
  hour: 4,
  minute: 0,
})
export class QuarterlyJob extends CronJob {}
```

## Ranges, lists and steps

String values allow normal cron-field expressions such as:

```ts
@Cron({ minute: '*/10' })
```

```ts
@Cron({ hour: '8-17', minute: 0 })
```

```ts
@Cron({ minute: '0,15,30,45' })
```

Arrays are often easier to read when all values are static:

```ts
@Cron({ minute: [0, 15, 30, 45] })
```

Cron strings may not contain whitespace because each decorator property represents exactly one cron field.

## Combining fields

Fields are combined directly. For example:

```ts
@Cron({
  minute: '*/15',
  hour: '8-17',
  weekday: 'MON-FRI',
})
export class BusinessHoursSync extends CronJob {}
```

This runs every 15 minutes during the selected weekday hours.

## Inject dependencies

Cron jobs participate in Honovel dependency injection:

```ts
@Cron({ hour: 2, minute: 0 })
export class CleanupExpiredBookings extends CronJob {
  constructor(private readonly bookings: BookingRepository) {
    super()
  }

  async handle() {
    await this.bookings.deleteExpired()
  }
}
```

A fresh execution scope is created when the job runs.

## Dispatch queued work

Cron jobs are often best used as lightweight triggers that enqueue the actual work:

```ts
@Cron({ minute: '*/5' })
export class DispatchDueReminders extends CronJob {
  constructor(private readonly dispatcher: Dispatcher) {
    super()
  }

  async handle() {
    await this.dispatcher.dispatch(new SendDueReminders())
  }
}
```

This keeps recurring scheduling separate from potentially long-running background processing.

## Cloudflare Workers

Cloudflare Cron Triggers execute in UTC with minute-level precision. Honovel discovers all `@Cron()` schedules during compilation and writes the resulting expressions into the generated deployment configuration used by Wrangler.

The application's source `wrangler.jsonc` remains application-owned; Honovel generates the effective cron trigger list for deployment.

If your product requirement uses a local timezone, account for daylight-saving changes. A schedule such as `hour: 8` means 08:00 UTC on Cloudflare, not automatically 08:00 in the application's local timezone.

## Cron vs one-off scheduling

Cron is intended for recurring triggers. It does not persist arbitrary future jobs, recover missed one-off executions or act as a durable scheduler.

For a one-off future action, store its due time in application data and let a recurring cron job find due records and dispatch queued work.
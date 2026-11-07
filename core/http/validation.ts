export type ValidationPathSegment =
  | PropertyKey
  | {
      key: PropertyKey
    }

export interface ValidationIssue {
  message: string
  path: readonly ValidationPathSegment[]
}

export interface SafeParseSchema<TOutput = unknown> {
  safeParse(input: unknown):
    | {
        success: true
        data: TOutput
      }
    | {
        success: false
        error: {
          issues?: readonly {
            message?: string
            path?: readonly ValidationPathSegment[]
          }[]
        }
      }
}

export interface StandardSchema<TOutput = unknown> {
  readonly '~standard': {
    readonly types?: {
      readonly output: TOutput
    }
    validate(input: unknown):
      | {
          value: TOutput
          issues?: undefined
        }
      | {
          issues: readonly {
            message?: string
            path?: readonly ValidationPathSegment[]
          }[]
          value?: undefined
        }
      | Promise<
          | {
              value: TOutput
              issues?: undefined
            }
          | {
              issues: readonly {
                message?: string
                path?: readonly ValidationPathSegment[]
              }[]
              value?: undefined
            }
        >
  }
}

export type ValidationSchema<TOutput = unknown> =
  | SafeParseSchema<TOutput>
  | StandardSchema<TOutput>

export type InferSchema<TSchema> =
  TSchema extends { readonly _output: infer TOutput }
    ? TOutput
    : TSchema extends SafeParseSchema<infer TOutput>
      ? TOutput
      : TSchema extends StandardSchema<infer TOutput>
        ? TOutput
        : never

export type ValidationResult<TOutput> =
  | {
      success: true
      data: TOutput
    }
  | {
      success: false
      issues: ValidationIssue[]
    }

function normalizeIssues(
  issues: readonly {
    message?: string
    path?: readonly ValidationPathSegment[]
  }[] | undefined,
): ValidationIssue[] {
  if (!issues?.length) {
    return [
      {
        message: 'The value is invalid.',
        path: [],
      },
    ]
  }

  return issues.map((issue) => ({
    message: issue.message ?? 'The value is invalid.',
    path: issue.path ?? [],
  }))
}

export async function validateSchema<TOutput>(
  schema: ValidationSchema<TOutput>,
  input: unknown,
): Promise<ValidationResult<TOutput>> {
  if ('safeParse' in schema) {
    const result = schema.safeParse(input)

    if (result.success) {
      return {
        success: true,
        data: result.data,
      }
    }

    return {
      success: false,
      issues: normalizeIssues(result.error.issues),
    }
  }

  const result = await schema['~standard'].validate(input)

  if ('issues' in result) {
    return {
      success: false,
      issues: normalizeIssues(result.issues),
    }
  }

  return {
    success: true,
    data: result.value,
  }
}

function pathToKey(path: readonly ValidationPathSegment[]): string {
  if (!path.length) {
    return 'request'
  }

  return path
    .map((segment) => {
      const key = typeof segment === 'object' ? segment.key : segment
      return String(key)
    })
    .join('.')
}

export class ValidationException extends Error {
  constructor(
    public readonly issues: ValidationIssue[],
    public readonly source: 'body' | 'query' | 'param',
  ) {
    super('The given data was invalid.')
    this.name = 'ValidationException'
  }

  toResponse(): {
    message: string
    errors: Record<string, string[]>
  } {
    const errors: Record<string, string[]> = {}

    for (const issue of this.issues) {
      const key = pathToKey(issue.path)
      errors[key] ??= []
      errors[key].push(issue.message)
    }

    return {
      message: this.message,
      errors,
    }
  }
}

import type { HonoRequest } from 'hono/request'
import type { InferSchema, ValidationSchema } from './validation'

const formRequestMarker = Symbol('honovel.form-request')
const requestData = new WeakMap<object, unknown>()
const honoRequests = new WeakMap<object, HonoRequest>()
const reservedFields = new Set(['req', 'validated'])

export interface FormRequestMethods<TSchema extends ValidationSchema> {
  readonly req: HonoRequest
  validated(): InferSchema<TSchema>
}

type FormRequestFields<TSchema extends ValidationSchema> =
  InferSchema<TSchema> extends object ? InferSchema<TSchema> : Record<never, never>

export type FormRequestInstance<TSchema extends ValidationSchema> =
  FormRequestMethods<TSchema> & FormRequestFields<TSchema>

export type FormRequestConstructor<
  TSchema extends ValidationSchema = ValidationSchema,
> = {
  new (data: InferSchema<TSchema>, request: HonoRequest): FormRequestInstance<TSchema>
  readonly schema: TSchema
}

abstract class BaseFormRequest<TSchema extends ValidationSchema>
  implements FormRequestMethods<TSchema>
{
  constructor(data: InferSchema<TSchema>, request: HonoRequest) {
    requestData.set(this, data)
    honoRequests.set(this, request)

    if (typeof data === 'object' && data !== null) {
      for (const key of Object.keys(data)) {
        if (reservedFields.has(key)) {
          throw new Error(`FormRequest field "${key}" is reserved by Honovel.`)
        }
      }

      Object.assign(this, data)
    }
  }

  get req(): HonoRequest {
    const request = honoRequests.get(this)
    if (!request) throw new Error('FormRequest is not bound to a Hono request.')
    return request
  }

  validated(): InferSchema<TSchema> {
    return requestData.get(this) as InferSchema<TSchema>
  }
}

export function FormRequest<TSchema extends ValidationSchema>(
  schema: TSchema,
): FormRequestConstructor<TSchema> {
  class SchemaFormRequest extends BaseFormRequest<TSchema> {
    static readonly schema = schema
  }

  Object.defineProperty(SchemaFormRequest, formRequestMarker, {
    value: true,
  })

  return SchemaFormRequest as unknown as FormRequestConstructor<TSchema>
}

export function isFormRequestConstructor(
  value: unknown,
): value is FormRequestConstructor {
  if (typeof value !== 'function') {
    return false
  }

  const constructor = value as unknown as {
    schema?: ValidationSchema
    [formRequestMarker]?: boolean
  }

  return constructor[formRequestMarker] === true && !!constructor.schema
}

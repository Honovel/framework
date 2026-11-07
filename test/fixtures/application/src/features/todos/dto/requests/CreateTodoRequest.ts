import { z } from 'zod'
import { FormRequest } from '../../../../../core'

export class CreateTodoRequest extends FormRequest(
  z.object({
    title: z.string(),
    completed: z.boolean().optional(),
  }),
) {}

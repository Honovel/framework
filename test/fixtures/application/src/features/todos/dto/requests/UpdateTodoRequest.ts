import { z } from 'zod'
import { FormRequest } from '../../../../../core'

export class UpdateTodoRequest extends FormRequest(
  z.object({
    title: z.string().optional(),
    completed: z.boolean().optional(),
  }),
) {}

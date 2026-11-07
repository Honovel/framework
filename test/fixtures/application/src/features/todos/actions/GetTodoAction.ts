import type { Todo } from '../../../database/main/schema'
import { TodoRepository } from '../repositories/TodoRepository'

export class GetTodoAction {
  constructor(private readonly repository: TodoRepository) {}

  execute(id: number): Promise<Todo | undefined> {
    return this.repository.find(id)
  }
}

import type { NewTodo, Todo } from '../../../database/main/schema'
import { TodoRepository } from '../repositories/TodoRepository'

export class UpdateTodoAction {
  constructor(private readonly repository: TodoRepository) {}

  execute(id: number, input: Partial<NewTodo>): Promise<Todo | undefined> {
    return this.repository.update(id, input)
  }
}

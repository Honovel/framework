import type { NewTodo, Todo } from '../../../database/main/schema'
import { TodoRepository } from '../repositories/TodoRepository'

export class CreateTodoAction {
  constructor(private readonly repository: TodoRepository) {}

  execute(input: NewTodo): Promise<Todo> {
    return this.repository.create(input)
  }
}

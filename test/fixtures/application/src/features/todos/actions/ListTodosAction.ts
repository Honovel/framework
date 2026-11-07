import type { Todo } from '../../../database/main/schema'
import { TodoRepository } from '../repositories/TodoRepository'

export class ListTodosAction {
  constructor(private readonly repository: TodoRepository) {}

  async execute(): Promise<Todo[]> {
    return this.repository.all()
  }
}

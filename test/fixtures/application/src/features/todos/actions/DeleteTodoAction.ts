import { TodoRepository } from '../repositories/TodoRepository'

export class DeleteTodoAction {
  constructor(private readonly repository: TodoRepository) {}

  execute(id: number): Promise<void> {
    return this.repository.delete(id)
  }
}

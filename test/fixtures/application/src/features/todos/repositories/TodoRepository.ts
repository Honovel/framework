import { todos } from '../../../database/main/schema'
import type { NewTodo, Todo } from '../../../database/main/schema'
import { MainDatabase } from '../../../database/main/MainDatabase'

export class TodoRepository {
  constructor(private readonly database: MainDatabase) {}

  all(): Promise<Todo[]> {
    return this.database.client.select().from(todos)
  }

  create(_input: NewTodo): Promise<Todo> {
    throw new Error('Not implemented.')
  }

  find(_id: number): Promise<Todo | undefined> {
    throw new Error('Not implemented.')
  }

  update(_id: number, _input: Partial<NewTodo>): Promise<Todo | undefined> {
    throw new Error('Not implemented.')
  }

  delete(_id: number): Promise<void> {
    throw new Error('Not implemented.')
  }
}

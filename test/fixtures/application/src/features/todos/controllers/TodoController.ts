import { BaseUrl, Controller, Delete, Get, Post, Put } from '../../../../core'
import { CreateTodoRequest } from '../dto/requests/CreateTodoRequest'
import { UpdateTodoRequest } from '../dto/requests/UpdateTodoRequest'
import type { TodoResponse } from '../dto/responses/TodoResponse'
import { ListTodosAction } from '../actions/ListTodosAction'
import { CreateTodoAction } from '../actions/CreateTodoAction'
import { GetTodoAction } from '../actions/GetTodoAction'
import { UpdateTodoAction } from '../actions/UpdateTodoAction'
import { DeleteTodoAction } from '../actions/DeleteTodoAction'

@BaseUrl('/todos')
export class TodoController extends Controller {
  constructor(
    private readonly listTodos: ListTodosAction,
    private readonly createTodo: CreateTodoAction,
    private readonly getTodo: GetTodoAction,
    private readonly updateTodo: UpdateTodoAction,
    private readonly deleteTodo: DeleteTodoAction,
  ) {
    super()
  }

  @Get('/')
  async index(): Promise<TodoResponse[]> {
    return this.listTodos.execute()
  }

  @Post('/')
  async store(request: CreateTodoRequest): Promise<TodoResponse> {
    return this.createTodo.execute(request.validated())
  }

  @Get('/:id')
  async get(id: number): Promise<TodoResponse | undefined> {
    return this.getTodo.execute(id)
  }

  @Put('/:id')
  async update(id: number, request: UpdateTodoRequest): Promise<TodoResponse | undefined> {
    return this.updateTodo.execute(id, request.validated())
  }

  @Delete('/:id')
  async destroy(id: number): Promise<void> {
    await this.deleteTodo.execute(id)
  }
}

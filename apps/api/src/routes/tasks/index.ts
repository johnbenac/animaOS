// Task routes — CRUD for user tasks

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { taskQuerySchema, createTaskSchema, updateTaskSchema } from "./schema";
import { listTasks, createTask, updateTask, deleteTask } from "./handlers";

const tasks = new Hono();

tasks.get("/", zValidator("query", taskQuerySchema), listTasks);
tasks.post("/", zValidator("json", createTaskSchema), createTask);
tasks.put("/:id", zValidator("json", updateTaskSchema), updateTask);
tasks.delete("/:id", deleteTask);

export default tasks;

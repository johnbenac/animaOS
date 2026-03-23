/**
 * Dispatch Bus Tests
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { DispatchBusImpl } from "../../src/core/dispatch.js";
import type { Task, InboundMessage } from "../../src/core/types.js";

describe("DispatchBusImpl", () => {
  beforeEach(() => {
    DispatchBusImpl.reset();
  });

  it("should be a singleton", () => {
    const instance1 = DispatchBusImpl.getInstance();
    const instance2 = DispatchBusImpl.getInstance();
    expect(instance1).toBe(instance2);
  });

  it("should create tasks and notify handlers", async () => {
    const bus = DispatchBusImpl.getInstance();
    const tasks: Task[] = [];

    bus.onTask((task) => {
      tasks.push(task);
    });

    const taskId = await bus.createTask({
      type: "test",
      title: "Test Task",
      priority: "normal",
      status: "pending",
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe(taskId);
    expect(tasks[0].title).toBe("Test Task");
  });

  it("should support multiple task handlers", async () => {
    const bus = DispatchBusImpl.getInstance();
    const handler1Tasks: Task[] = [];
    const handler2Tasks: Task[] = [];

    bus.onTask((task) => handler1Tasks.push(task));
    bus.onTask((task) => handler2Tasks.push(task));

    await bus.createTask({
      type: "test",
      title: "Multi Handler Test",
      priority: "normal",
      status: "pending",
    });

    expect(handler1Tasks).toHaveLength(1);
    expect(handler2Tasks).toHaveLength(1);
  });

  it("should allow unsubscribing handlers", async () => {
    const bus = DispatchBusImpl.getInstance();
    const tasks: Task[] = [];

    const unsubscribe = bus.onTask((task) => tasks.push(task));
    
    await bus.createTask({
      type: "test",
      title: "First",
      priority: "normal",
      status: "pending",
    });

    expect(tasks).toHaveLength(1);

    unsubscribe();

    await bus.createTask({
      type: "test",
      title: "Second",
      priority: "normal",
      status: "pending",
    });

    expect(tasks).toHaveLength(1); // Second task not received
  });

  it("should emit messages to handlers", async () => {
    const bus = DispatchBusImpl.getInstance();
    const messages: InboundMessage[] = [];

    bus.onMessage((msg) => messages.push(msg));

    const testMsg: InboundMessage = {
      id: "1",
      source: "telegram",
      chatId: "123",
      userId: 1,
      text: "Hello",
      timestamp: new Date(),
      raw: {},
    };

    await bus.emitMessage(testMsg);

    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe("Hello");
  });
});

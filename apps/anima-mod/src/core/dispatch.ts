/**
 * a-mod: Dispatch Bus
 * 
 * Cross-module communication system.
 * Singleton pattern - one bus for all modules.
 */

import type { 
  DispatchBus, 
  InboundMessage, 
  Task, 
  MessageHandler, 
  TaskHandler,
  SendOptions 
} from "./types.js";

export class DispatchBusImpl implements DispatchBus {
  private static instance: DispatchBusImpl | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private taskHandlers: Set<TaskHandler> = new Set();

  static getInstance(): DispatchBusImpl {
    if (!DispatchBusImpl.instance) {
      DispatchBusImpl.instance = new DispatchBusImpl();
    }
    return DispatchBusImpl.instance;
  }

  // Prevent direct construction
  private constructor() {}

  /**
   * Send message to user across their linked channels
   */
  async sendToUser(userId: number, message: string, options?: SendOptions): Promise<void> {
    // TODO: Implement user-to-channel routing
    // Look up user's preferred/linked channels and route message
    console.log("[dispatch] sendToUser", { userId, message, options });
  }

  /**
   * Send message to specific channel/chat
   */
  async sendToChannel(channel: string, chatId: string, message: string): Promise<void> {
    // TODO: Find module by channel type and send
    console.log("[dispatch] sendToChannel", { channel, chatId, message });
  }

  /**
   * Subscribe to messages
   */
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  /**
   * Subscribe to tasks
   */
  onTask(handler: TaskHandler): () => void {
    this.taskHandlers.add(handler);
    return () => this.taskHandlers.delete(handler);
  }

  /**
   * Create a task
   */
  async createTask(task: Omit<Task, "id">): Promise<string> {
    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const fullTask: Task = { ...task, id };
    
    // Notify task handlers
    for (const handler of this.taskHandlers) {
      try {
        await handler(fullTask);
      } catch (err) {
        console.error("[dispatch] Task handler error:", err);
      }
    }
    
    return id;
  }

  /**
   * Internal: Emit inbound message to all handlers
   */
  async emitMessage(msg: InboundMessage): Promise<void> {
    for (const handler of this.messageHandlers) {
      try {
        await handler(msg);
      } catch (err) {
        console.error("[dispatch] Message handler error:", err);
      }
    }
  }

  /**
   * Reset (for testing)
   */
  static reset(): void {
    DispatchBusImpl.instance = null;
  }
}

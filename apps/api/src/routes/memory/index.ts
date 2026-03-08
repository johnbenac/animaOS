// Memory routes — browse, read, write, and delete memory files

import { Hono } from "hono";
import {
  listUserMemories,
  searchUserMemories,
  readUserMemory,
  writeUserMemory,
  appendUserMemory,
  deleteUserMemory,
  writeJournal,
} from "./handlers";

const memory = new Hono();

memory.get("/:userId", listUserMemories);
memory.get("/:userId/search", searchUserMemories);
memory.get("/:userId/:section/:filename", readUserMemory);
memory.put("/:userId/:section/:filename", writeUserMemory);
memory.post("/:userId/:section/:filename", appendUserMemory);
memory.delete("/:userId/:section/:filename", deleteUserMemory);
memory.post("/:userId/journal", writeJournal);

export default memory;

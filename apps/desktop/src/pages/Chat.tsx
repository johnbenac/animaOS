import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api, type ChatMessage } from "../lib/api";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import "highlight.js/styles/github-dark.css";

export default function Chat() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState("");
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load history on mount
  useEffect(() => {
    if (user?.id) {
      api.chat.history(user.id).then(setMessages).catch(console.error);
    }
  }, [user?.id]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamBuffer]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
    }
  }, [input]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !user?.id || streaming) return;

    const userMsg = input.trim();
    setInput("");
    setError("");

    // Optimistic add user message
    const tempUserMsg: ChatMessage = {
      id: Date.now(),
      userId: user.id,
      role: "user",
      content: userMsg,
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    // Stream response
    setStreaming(true);
    setStreamBuffer("");

    try {
      let fullResponse = "";
      for await (const chunk of api.chat.stream(userMsg, user.id)) {
        fullResponse += chunk;
        setStreamBuffer(fullResponse);
      }

      // Add final assistant message
      const assistantMsg: ChatMessage = {
        id: Date.now() + 1,
        userId: user.id,
        role: "assistant",
        content: fullResponse || "[no response]",
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setStreamBuffer("");
    } catch (err: any) {
      setError(err.message || "Connection failed");
    } finally {
      setStreaming(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const clearHistory = async () => {
    if (!user?.id) return;
    await api.chat.clearHistory(user.id);
    setMessages([]);
  };

  return (
    <div className="flex flex-col h-screen bg-(--color-bg) text-(--color-text) font-(family-name:--font-mono)">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-(--color-border)">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate("/")}
            className="text-(--color-text-muted) hover:text-(--color-text) text-xs uppercase tracking-wider"
          >
            ← SYS
          </button>
          <span className="text-sm tracking-widest uppercase">
            ▸ ANIMA<span className="text-(--color-text-muted)">::CHAT</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={clearHistory}
            className="text-xs text-(--color-text-muted) hover:text-(--color-danger) uppercase tracking-wider"
          >
            CLR
          </button>
          <button
            onClick={() => navigate("/memory")}
            className="text-xs text-(--color-text-muted) hover:text-(--color-text) uppercase tracking-wider"
          >
            MEM
          </button>
          <button
            onClick={() => navigate("/settings")}
            className="text-xs text-(--color-text-muted) hover:text-(--color-text) uppercase tracking-wider"
          >
            CFG
          </button>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !streaming && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-(--color-text-muted) text-sm tracking-wider uppercase mb-2">
                // TERMINAL READY
              </p>
              <p className="text-(--color-text-muted) text-xs">
                Type below to begin communication
              </p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Streaming indicator */}
        {streaming && streamBuffer && (
          <div className="flex gap-3">
            <div className="text-xs text-(--color-text-muted) pt-1 select-none shrink-0">
              SYS
            </div>
            <div className="bg-(--color-bg-card) border border-(--color-border) rounded-sm px-3 py-2 max-w-[80%]">
              <div className="prose prose-invert prose-sm max-w-none">
                <ReactMarkdown rehypePlugins={[rehypeHighlight, rehypeRaw]}>
                  {streamBuffer}
                </ReactMarkdown>
                <span className="inline-block w-1.5 h-4 bg-(--color-primary) ml-0.5 animate-pulse" />
              </div>
            </div>
          </div>
        )}

        {streaming && !streamBuffer && (
          <div className="flex gap-3">
            <div className="text-xs text-(--color-text-muted) pt-1 select-none shrink-0">
              SYS
            </div>
            <div className="bg-(--color-bg-card) border border-(--color-border) rounded-sm px-3 py-2">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-(--color-text-muted) rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-(--color-text-muted) rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-(--color-text-muted) rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-(--color-bg-card) border border-(--color-danger)/30 rounded-sm px-3 py-2 text-(--color-danger) text-sm">
            ERR: {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-(--color-border) px-4 py-3"
      >
        <div className="flex gap-3 items-end">
          <div className="text-xs text-(--color-text-muted) pt-2 select-none shrink-0">
            &gt;
          </div>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Input command..."
            disabled={streaming}
            rows={1}
            className="flex-1 bg-transparent text-sm text-(--color-text) placeholder:text-(--color-text-muted)/50 outline-none resize-none max-h-32 py-1"
          />
          <button
            type="submit"
            disabled={!input.trim() || streaming}
            className="text-xs text-(--color-text-muted) hover:text-(--color-text) disabled:opacity-30 uppercase tracking-wider pb-1"
          >
            TX →
          </button>
        </div>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : ""}`}>
      {!isUser && (
        <div className="text-xs text-(--color-text-muted) pt-1 select-none shrink-0">
          SYS
        </div>
      )}
      <div
        className={`rounded-sm px-3 py-2 max-w-[80%] ${
          isUser
            ? "bg-(--color-bg-input) border border-(--color-border)"
            : "bg-(--color-bg-card) border border-(--color-border)"
        }`}
      >
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap break-words">
            {message.content}
          </p>
        ) : (
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown rehypePlugins={[rehypeHighlight, rehypeRaw]}>
              {message.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
      {isUser && (
        <div className="text-xs text-(--color-text-muted) pt-1 select-none shrink-0">
          USR
        </div>
      )}
    </div>
  );
}

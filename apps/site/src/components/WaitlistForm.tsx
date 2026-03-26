import { useState } from "react";

export default function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setStatus("submitting");

    try {
      // TODO: Replace with real endpoint (Formspree, Buttondown, etc.)
      await new Promise((resolve) => setTimeout(resolve, 800));
      setStatus("success");
      setEmail("");
    } catch {
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <p className="font-mono text-xs tracking-[0.2em] uppercase text-success">
        You're on the list. We'll be in touch.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 w-full max-w-md mx-auto">
      <input
        type="email"
        required
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="flex-1 bg-bg-input border border-border px-4 py-3 font-mono text-xs text-text placeholder:text-text-muted/50 focus:border-primary focus:outline-none transition-colors"
      />
      <button
        type="submit"
        disabled={status === "submitting"}
        className="bg-primary hover:bg-primary-hover text-bg font-mono text-xs tracking-[0.2em] uppercase px-6 py-3 transition-colors disabled:opacity-50"
      >
        {status === "submitting" ? "..." : "Join the waitlist"}
      </button>
      {status === "error" && (
        <p className="font-mono text-xs text-danger mt-1">Something went wrong. Try again.</p>
      )}
    </form>
  );
}

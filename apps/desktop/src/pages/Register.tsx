import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

export default function Register() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { setUser } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const user = await api.auth.register(username, password, name);
      setUser(user);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Access creation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen p-8">
      <div className="w-full max-w-[400px]">
        <div className="text-center mb-10">
          <h1 className="font-mono text-3xl font-bold tracking-[0.4em] text-text uppercase">
            ANIMA
          </h1>
          <p className="font-mono text-text-muted text-xs mt-2 tracking-widest uppercase">
            life operating system
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-bg-card border border-border rounded-sm p-8"
        >
          <h2 className="font-mono text-sm font-medium mb-6 tracking-wider uppercase text-text-muted">
            // Create Access
          </h2>

          {error && (
            <div className="bg-danger/10 border border-danger/30 text-danger px-3.5 py-2.5 rounded-sm font-mono text-xs mb-4">
              {error}
            </div>
          )}

          <div className="mb-5">
            <label
              htmlFor="name"
              className="block font-mono text-[11px] font-medium text-text-muted mb-1.5 uppercase tracking-wider"
            >
              Identity
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="your name"
              required
              autoFocus
              className="w-full px-3.5 py-2.5 bg-bg-input border border-border rounded-sm text-text font-mono text-sm outline-none transition-colors focus:border-text-muted placeholder:text-text-muted/40"
            />
          </div>

          <div className="mb-5">
            <label
              htmlFor="username"
              className="block font-mono text-[11px] font-medium text-text-muted mb-1.5 uppercase tracking-wider"
            >
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="choose identifier"
              required
              className="w-full px-3.5 py-2.5 bg-bg-input border border-border rounded-sm text-text font-mono text-sm outline-none transition-colors focus:border-text-muted placeholder:text-text-muted/40"
            />
          </div>

          <div className="mb-5">
            <label
              htmlFor="password"
              className="block font-mono text-[11px] font-medium text-text-muted mb-1.5 uppercase tracking-wider"
            >
              Passkey
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="min 6 characters"
              required
              minLength={6}
              className="w-full px-3.5 py-2.5 bg-bg-input border border-border rounded-sm text-text font-mono text-sm outline-none transition-colors focus:border-text-muted placeholder:text-text-muted/40"
            />
          </div>

          <button
            type="submit"
            className="w-full py-2.5 px-5 bg-text text-bg border-none rounded-sm font-mono text-sm font-semibold uppercase tracking-wider cursor-pointer transition-colors hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={loading}
          >
            {loading ? "Creating..." : "Create Access →"}
          </button>
        </form>

        <p className="text-center mt-6 font-mono text-xs text-text-muted tracking-wide">
          Have access?{" "}
          <Link
            to="/login"
            className="text-text hover:opacity-70 underline underline-offset-4"
          >
            Enter
          </Link>
        </p>
      </div>
    </div>
  );
}

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { setUser } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await api.auth.login(username, password);
      setUser({ id: res.id, username: res.username, name: res.name });
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Access denied");
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
            // Access
          </h2>

          {error && (
            <div className="bg-danger/10 border border-danger/30 text-danger px-3.5 py-2.5 rounded-sm font-mono text-xs mb-4">
              {error}
            </div>
          )}

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
              placeholder="enter identifier"
              required
              autoFocus
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
              placeholder="enter passkey"
              required
              className="w-full px-3.5 py-2.5 bg-bg-input border border-border rounded-sm text-text font-mono text-sm outline-none transition-colors focus:border-text-muted placeholder:text-text-muted/40"
            />
          </div>

          <button
            type="submit"
            className="w-full py-2.5 px-5 bg-text text-bg border-none rounded-sm font-mono text-sm font-semibold uppercase tracking-wider cursor-pointer transition-colors hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={loading}
          >
            {loading ? "Accessing..." : "Access →"}
          </button>
        </form>

        <p className="text-center mt-6 font-mono text-xs text-text-muted tracking-wide">
          No access?{" "}
          <Link
            to="/register"
            className="text-text hover:opacity-70 underline underline-offset-4"
          >
            Create access
          </Link>
        </p>
      </div>
    </div>
  );
}

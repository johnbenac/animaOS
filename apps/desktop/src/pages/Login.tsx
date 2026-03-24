import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Field } from "@anima/ui";
import { api, setUnlockToken } from "../lib/api";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const { setUser } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await api.auth.login(username, password);
      setUnlockToken(res.unlockToken);
      setUser({ id: res.id, username: res.username, name: res.name });
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Access denied");
    } finally {
      setLoading(false);
    }
  }

  async function handleRecover(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }

    setLoading(true);
    try {
      const res = await api.auth.recover(phrase.trim().toLowerCase(), newPassword);
      setUnlockToken(res.unlockToken);
      setUser({ id: res.id, username: res.username, name: res.name });
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recovery failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen p-8 bg-bg">
      <div className="w-full max-w-[380px]">
        <div className="text-center mb-12">
          <h1 className="font-mono text-lg font-medium tracking-[0.3em] text-text">
            ANIMA
          </h1>
        </div>

        {!recovering ? (
          <form onSubmit={handleSubmit} className="space-y-3">
            {error && (
              <div className="bg-danger/5 border-l-2 border-danger text-danger px-3.5 py-2.5 font-mono text-[10px] tracking-wider">
                {error}
              </div>
            )}

            <Field
              label="Username"
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              required
              autoFocus
            />

            <Field
              label="Password"
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              required
            />

            <button
              type="submit"
              className="w-full py-2.5 bg-primary/[0.08] text-primary border border-primary/30 font-mono text-[10px] tracking-wider cursor-pointer transition-colors hover:bg-primary/[0.12] disabled:opacity-30 disabled:cursor-not-allowed"
              disabled={loading}
            >
              {loading ? "UNLOCKING..." : "UNLOCK"}
            </button>

            <button
              type="button"
              onClick={() => { setRecovering(true); setError(""); }}
              className="w-full py-1.5 text-text/30 font-mono text-[10px] tracking-wider cursor-pointer transition-colors hover:text-text/50"
            >
              Forgot password?
            </button>
          </form>
        ) : (
          <form onSubmit={handleRecover} className="space-y-3">
            {error && (
              <div className="bg-danger/5 border-l-2 border-danger text-danger px-3.5 py-2.5 font-mono text-[10px] tracking-wider">
                {error}
              </div>
            )}

            <Field
              label="Recovery phrase"
              id="phrase"
              type="text"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder="Enter your 12-word recovery phrase"
              required
              autoFocus
            />

            <Field
              label="New password"
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
            />

            <Field
              label="Confirm password"
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Type it again"
              required
            />

            <button
              type="submit"
              className="w-full py-2.5 bg-primary/[0.08] text-primary border border-primary/30 font-mono text-[10px] tracking-wider cursor-pointer transition-colors hover:bg-primary/[0.12] disabled:opacity-30 disabled:cursor-not-allowed"
              disabled={loading}
            >
              {loading ? "RECOVERING..." : "RECOVER ACCOUNT"}
            </button>

            <button
              type="button"
              onClick={() => { setRecovering(false); setError(""); }}
              className="w-full py-1.5 text-text/30 font-mono text-[10px] tracking-wider cursor-pointer transition-colors hover:text-text/50"
            >
              Back to login
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

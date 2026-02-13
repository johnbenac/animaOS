import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";

export default function Profile() {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name || "");
  const [gender, setGender] = useState(user?.gender || "");
  const [age, setAge] = useState(user?.age?.toString() || "");
  const [birthday, setBirthday] = useState(user?.birthday || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  if (!user) return null;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);

    try {
      const updated = await api.users.update(user!.id, {
        name,
        gender: gender || undefined,
        age: age ? parseInt(age) : undefined,
        birthday: birthday || undefined,
      });
      setUser(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Are you sure? This will permanently delete your account."))
      return;

    try {
      await api.users.delete(user!.id);
      logout();
      navigate("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <div className="min-h-screen">
      <nav className="flex items-center justify-between px-6 py-3 border-b border-border bg-bg-card">
        <div className="flex items-center gap-2">
          <Link
            to="/"
            className="flex items-center gap-2 text-inherit no-underline"
          >
            <span className="font-mono text-xs text-text-muted">▸</span>
            <span className="font-mono font-bold text-xs tracking-[0.2em] uppercase">
              ANIMA
            </span>
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="font-mono text-[11px] text-text-muted transition-colors hover:text-text uppercase tracking-wider"
          >
            Dashboard
          </Link>
          <button
            onClick={logout}
            className="bg-transparent text-text-muted border border-border px-3 py-1.5 rounded-sm font-mono text-[11px] uppercase tracking-wider cursor-pointer transition-colors hover:text-text hover:border-text-muted"
          >
            Exit
          </button>
        </div>
      </nav>

      <main className="max-w-[900px] mx-auto px-6 py-10">
        <div className="max-w-[560px]">
          <div className="flex items-center gap-5 mb-8">
            <div className="w-14 h-14 rounded-sm bg-text text-bg flex items-center justify-center font-mono text-lg font-bold shrink-0">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 className="font-mono text-lg font-bold tracking-wide">
                {user.name}
              </h1>
              <p className="font-mono text-text-muted text-xs">
                @{user.username}
              </p>
            </div>
          </div>

          {error && (
            <div className="bg-danger/10 border border-danger/30 text-danger px-3.5 py-2.5 rounded-sm font-mono text-xs mb-4">
              {error}
            </div>
          )}

          {editing ? (
            <form
              onSubmit={handleSave}
              className="bg-bg-card border border-border rounded-sm p-6"
            >
              <div className="mb-5">
                <label
                  htmlFor="name"
                  className="block font-mono text-[11px] font-medium text-text-muted mb-1.5 uppercase tracking-wider"
                >
                  Name
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 bg-bg-input border border-border rounded-sm text-text font-mono text-sm outline-none transition-colors focus:border-text-muted"
                />
              </div>
              <div className="mb-5">
                <label
                  htmlFor="gender"
                  className="block font-mono text-[11px] font-medium text-text-muted mb-1.5 uppercase tracking-wider"
                >
                  Gender
                </label>
                <select
                  id="gender"
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-bg-input border border-border rounded-sm text-text font-mono text-sm outline-none transition-colors focus:border-text-muted"
                >
                  <option value="">—</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="mb-5">
                <label
                  htmlFor="age"
                  className="block font-mono text-[11px] font-medium text-text-muted mb-1.5 uppercase tracking-wider"
                >
                  Age
                </label>
                <input
                  id="age"
                  type="number"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  min="1"
                  max="150"
                  className="w-full px-3.5 py-2.5 bg-bg-input border border-border rounded-sm text-text font-mono text-sm outline-none transition-colors focus:border-text-muted"
                />
              </div>
              <div className="mb-5">
                <label
                  htmlFor="birthday"
                  className="block font-mono text-[11px] font-medium text-text-muted mb-1.5 uppercase tracking-wider"
                >
                  Birthday
                </label>
                <input
                  id="birthday"
                  type="date"
                  value={birthday}
                  onChange={(e) => setBirthday(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-bg-input border border-border rounded-sm text-text font-mono text-sm outline-none transition-colors focus:border-text-muted"
                />
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  type="submit"
                  className="py-2.5 px-5 bg-text text-bg border-none rounded-sm font-mono text-sm font-semibold uppercase tracking-wider cursor-pointer transition-colors hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed"
                  disabled={saving}
                >
                  {saving ? "Saving..." : "Save Changes"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="bg-transparent text-text-muted border border-border px-3 py-1.5 rounded-sm font-mono text-[11px] uppercase tracking-wider cursor-pointer transition-colors hover:text-text hover:border-text-muted"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="bg-bg-card border border-border rounded-sm p-6">
              <div className="flex justify-between py-2.5 border-b border-border font-mono text-xs">
                <span className="text-text-muted font-medium uppercase tracking-wider">
                  Username
                </span>
                <span>{user.username}</span>
              </div>
              <div className="flex justify-between py-2.5 border-b border-border font-mono text-xs">
                <span className="text-text-muted font-medium uppercase tracking-wider">
                  Name
                </span>
                <span>{user.name}</span>
              </div>
              <div className="flex justify-between py-2.5 border-b border-border font-mono text-xs">
                <span className="text-text-muted font-medium uppercase tracking-wider">
                  Gender
                </span>
                <span>{user.gender || "—"}</span>
              </div>
              <div className="flex justify-between py-2.5 border-b border-border font-mono text-xs">
                <span className="text-text-muted font-medium uppercase tracking-wider">
                  Age
                </span>
                <span>{user.age || "—"}</span>
              </div>
              <div className="flex justify-between py-2.5 border-b border-border font-mono text-xs">
                <span className="text-text-muted font-medium uppercase tracking-wider">
                  Birthday
                </span>
                <span>{user.birthday || "—"}</span>
              </div>
              <div className="flex justify-between py-2.5 font-mono text-xs">
                <span className="text-text-muted font-medium uppercase tracking-wider">
                  Joined
                </span>
                <span>
                  {user.createdAt
                    ? new Date(user.createdAt).toLocaleDateString()
                    : "—"}
                </span>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setEditing(true)}
                  className="py-2 px-4 bg-text text-bg border-none rounded-sm font-mono text-[11px] font-semibold uppercase tracking-wider cursor-pointer transition-colors hover:bg-primary-hover"
                >
                  Edit
                </button>
                <button
                  onClick={handleDelete}
                  className="bg-transparent text-text-muted border border-border px-3 py-1.5 rounded-sm font-mono text-[11px] font-medium uppercase tracking-wider cursor-pointer transition-colors hover:text-text hover:border-text-muted"
                >
                  Delete Account
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

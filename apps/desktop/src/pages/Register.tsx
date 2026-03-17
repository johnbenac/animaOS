import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Field } from "@anima/ui";
import { api, setUnlockToken } from "../lib/api";
import { useAuth } from "../context/AuthContext";

type RegisterStep = "account" | "create-ai";

export default function Register() {
  const { isProvisioned } = useAuth();

  if (isProvisioned) {
    return <Navigate to="/login" replace />;
  }
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [agentName, setAgentName] = useState("Anima");
  const [step, setStep] = useState<RegisterStep>("account");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { setUser } = useAuth();
  const navigate = useNavigate();

  const isAccountStep = step === "account";

  function validateAccountFields(): boolean {
    if (!name || !username || !password) {
      setError("Please fill in all fields");
      return false;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return false;
    }
    return true;
  }

  function continueToCreateAI() {
    if (!validateAccountFields()) return;
    setError("");
    setStep("create-ai");
  }

  async function registerAccount() {
    if (!agentName.trim()) {
      setError("Give your AI a name");
      return;
    }
    setError("");
    setLoading(true);

    try {
      const user = await api.auth.register(
        username,
        password,
        name,
        "default",
        agentName.trim(),
      );
      setUnlockToken(user.unlockToken);
      setUser({ id: user.id, username: user.username, name: user.name });
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isAccountStep) {
      continueToCreateAI();
      return;
    }
    await registerAccount();
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg">
      <div className="relative mx-auto flex min-h-screen w-full max-w-[980px] items-center px-6 py-10">
        <div className="mx-auto w-full max-w-[460px]">
          <form
            onSubmit={handleSubmit}
            className="border border-border bg-bg-card p-7"
          >
            {/* Progress bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between font-mono text-[9px] tracking-wider text-text-muted/50">
                <span>STEP {isAccountStep ? "1" : "2"}/2</span>
                <span>
                  {isAccountStep ? "ACCOUNT" : "NAME YOUR AI"}
                </span>
              </div>
              <div className="h-px bg-border">
                <div
                  className={`h-full bg-primary transition-all duration-300 ${
                    isAccountStep ? "w-1/2" : "w-full"
                  }`}
                />
              </div>
            </div>

            {/* Header */}
            <div className="mt-6 mb-5">
              <h2 className="font-mono text-sm tracking-wider text-text">
                {isAccountStep ? "CREATE LOCAL VAULT" : "NAME YOUR AI"}
              </h2>
              <p className="mt-1 font-mono text-[10px] text-text-muted/40 tracking-wider">
                {isAccountStep
                  ? "THESE CREDENTIALS UNLOCK YOUR ENCRYPTED LOCAL DATA."
                  : "THIS BECOMES ITS PERMANENT IDENTITY."}
              </p>
            </div>

            {error && (
              <div className="mb-5 border-l-2 border-danger bg-danger/5 px-3.5 py-2.5 font-mono text-[10px] text-danger tracking-wider">
                {error}
              </div>
            )}

            {/* Step content */}
            {isAccountStep ? (
              <div className="space-y-4">
                <Field
                  label="Your Name"
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  required
                  autoFocus
                />

                <Field
                  label="Username"
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Choose a username"
                  required
                />

                <Field
                  label="Password"
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 6 characters"
                  required
                  minLength={6}
                />
              </div>
            ) : (
              <Field
                label="AI Name"
                id="agentName"
                type="text"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="Anima"
                required
                autoFocus
                maxLength={50}
                hint="You can always change how it behaves later in settings."
              />
            )}

            {/* Actions */}
            <div className="mt-6 flex items-center gap-3">
              {!isAccountStep && (
                <button
                  type="button"
                  onClick={() => {
                    setError("");
                    setStep("account");
                  }}
                  className="border border-border px-4 py-2.5 font-mono text-[10px] tracking-wider text-text-muted transition-colors cursor-pointer hover:text-text hover:border-text-muted/30"
                >
                  BACK
                </button>
              )}
              <button
                type="submit"
                className="flex-1 py-2.5 font-mono text-[10px] tracking-wider bg-primary/[0.08] text-primary border border-primary/30 transition-colors cursor-pointer hover:bg-primary/[0.12] disabled:cursor-not-allowed disabled:opacity-30"
                disabled={loading}
              >
                {isAccountStep ? "CONTINUE" : loading ? "CREATING..." : "CREATE"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

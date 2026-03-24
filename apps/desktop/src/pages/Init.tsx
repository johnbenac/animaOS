import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api, setUnlockToken } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useAnimaSymbol } from "../lib/ascii-art";
import pkg from "../../package.json";

// ---------------------------------------------------------------------------
// Types & config
// ---------------------------------------------------------------------------

interface Line {
  id: number;
  type: "output" | "input" | "error";
  text: string;
  revealed: string;
}

interface StepDef {
  label: string;
  placeholder: string;
  password?: boolean;
}

const STEPS: StepDef[] = [
  { label: "name", placeholder: "e.g. Alice" },
  { label: "username", placeholder: "lowercase, no spaces" },
  { label: "password", placeholder: "at least 6 characters", password: true },
  { label: "verify", placeholder: "re-enter password", password: true },
  { label: "agent", placeholder: "e.g. Anima" },
  { label: "confirm", placeholder: "yes or no" },
  { label: "recovery", placeholder: "type 'saved' when done" },
];

const S = { NAME: 0, USERNAME: 1, PASSWORD: 2, VERIFY: 3, AGENT: 4, CONFIRM: 5, RECOVERY: 6 } as const;

const COPY = {
  askName: "What's your name?",
  greetAndUsername: (name: string) => `Nice to meet you, ${name}. Pick a username.`,
  askPassword: "Good. Now a password — at least 6 characters.",
  confirmPassword: "One more time — just to be sure.",
  askAgent: "What would you like to call me?",
  summary: (name: string, username: string, agent: string) => `${name} · ${username} · ${agent}`,
  confirmCreate: "Ready to go? Type yes to create your account.",
  creating: "Setting things up...",
  recoveryLabel: "Your recovery phrase:",
  recoveryWarning: "Write this down. It's the only way to recover your account.",
  allSet: "You're all set.",
  errTooShort: "Too short",
  errMinChars: "Min 6 chars",
  errNoMatch: "Doesn't match. Try again.",
  errCancelled: "Cancelled",
  errSaveFirst: "Type 'saved' when you've written it down.",
};

function getSymbolSpeed(done: boolean, inputLen: number, focused: boolean): number {
  if (done) return 4;
  if (inputLen > 0) return 2.5;
  if (focused) return 1.6;
  return 1;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Init() {
  const { isProvisioned, setUser } = useAuth();
  const navigate = useNavigate();
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [step, setStep] = useState(0);
  const [booting, setBooting] = useState(true);
  const [data, setData] = useState({ name: "", username: "", password: "", agent: "" });
  const [done, setDone] = useState(false);
  const [recoveryPhrase, setRecoveryPhrase] = useState<string | null>(null);
  const [pendingUser, setPendingUser] = useState<{ id: number; username: string; name: string } | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [copied, setCopied] = useState(false);

  const cur = STEPS[step];
  const isRevealing = lines.some((l) => l.revealed.length < l.text.length);
  const animaSymbol = useAnimaSymbol(getSymbolSpeed(done, input.length, isFocused));
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);
  const stepSnapshots = useRef(new Map<number, number>());

  // --- Derived state ---

  const lastQuestion = useMemo(() => {
    for (let i = lines.length - 1; i > 0; i--) {
      if (lines[i].type === "output") return lines[i];
    }
    return null;
  }, [lines]);

  const lastError = useMemo(() => {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].type === "error") return lines[i];
    }
    return null;
  }, [lines]);

  const historyPairs = useMemo(() => {
    const pairs: { question: Line; answer: Line }[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].type !== "input") continue;
      for (let j = i - 1; j > 0; j--) {
        if (lines[j].type === "output") {
          pairs.push({ question: lines[j], answer: lines[i] });
          break;
        }
      }
    }
    return pairs.slice(-2);
  }, [lines]);

  // --- Effects ---

  useEffect(() => {
    if (!isRevealing) return;
    const t = setTimeout(() => {
      setLines((prev) =>
        prev.map((l) =>
          l.revealed.length < l.text.length
            ? { ...l, revealed: l.text.slice(0, l.revealed.length + 1) }
            : l,
        ),
      );
    }, 18);
    return () => clearTimeout(t);
  }, [lines, isRevealing]);

  const addLine = useCallback((type: Line["type"], text: string) => {
    setLines((p) => [
      ...p,
      { id: idRef.current++, type, text, revealed: type === "input" ? text : "" },
    ]);
  }, []);

  useEffect(() => {
    addLine("output", `ANIMA OS v${pkg.version}`);
    setTimeout(() => {
      addLine("output", COPY.askName);
      setBooting(false);
    }, 600);
  }, [addLine]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  useEffect(() => {
    if (!booting && !done && !isRevealing) inputRef.current?.focus();
  }, [booting, done, step, isRevealing]);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => navigate("/"), 2000);
    return () => clearTimeout(t);
  }, [done, navigate]);

  if (isProvisioned && !done) return <Navigate to="/login" replace />;

  // --- Actions ---

  const advance = () => {
    setStep((s) => s + 1);
    setInput("");
  };

  const goBack = () => {
    if (step <= S.NAME || step >= S.RECOVERY || done || booting) return;

    const prevStep = step - 1;
    const snapshot = stepSnapshots.current.get(prevStep);
    if (snapshot !== undefined) {
      setLines((prev) => prev.slice(0, snapshot));
    }

    const restore: Record<number, string> = {
      [S.NAME]: data.name,
      [S.USERNAME]: data.username,
      [S.AGENT]: data.agent,
    };
    setInput(restore[prevStep] ?? "");
    setStep(prevStep);
    stepSnapshots.current.delete(prevStep);
    stepSnapshots.current.delete(step);
  };

  const submit = () => {
    if (!input.trim() || done || isRevealing) return;

    if (!stepSnapshots.current.has(step)) {
      stepSnapshots.current.set(step, lines.length);
    }

    const v = input.trim();
    addLine("input", `> ${cur.password ? "*".repeat(v.length) : v}`);

    switch (step) {
      case S.NAME:
        setData((d) => ({ ...d, name: v }));
        addLine("output", COPY.greetAndUsername(v));
        advance();
        break;
      case S.USERNAME:
        if (v.length < 2) return addLine("error", COPY.errTooShort);
        setData((d) => ({ ...d, username: v }));
        addLine("output", COPY.askPassword);
        advance();
        break;
      case S.PASSWORD:
        if (v.length < 6) return addLine("error", COPY.errMinChars);
        setData((d) => ({ ...d, password: v }));
        addLine("output", COPY.confirmPassword);
        advance();
        break;
      case S.VERIFY:
        if (v !== data.password) return addLine("error", COPY.errNoMatch);
        addLine("output", COPY.askAgent);
        advance();
        break;
      case S.AGENT: {
        const agent = v || "Anima";
        setData((d) => ({ ...d, agent }));
        addLine("output", COPY.summary(data.name, data.username, agent));
        addLine("output", COPY.confirmCreate);
        advance();
        break;
      }
      case S.CONFIRM:
        if (v.toLowerCase() !== "yes") return addLine("error", COPY.errCancelled);
        addLine("output", COPY.creating);
        create();
        break;
      case S.RECOVERY:
        if (v.toLowerCase() !== "saved") return addLine("error", COPY.errSaveFirst);
        if (pendingUser) setUser(pendingUser);
        addLine("output", COPY.allSet);
        setDone(true);
        break;
    }
  };

  const create = async () => {
    try {
      const u = await api.auth.register(
        data.username, data.password, data.name,
        "default", data.agent || "Anima", "", "companion",
      );
      setUnlockToken(u.unlockToken);

      if (u.recoveryPhrase) {
        setPendingUser({ id: u.id, username: u.username, name: u.name });
        setRecoveryPhrase(u.recoveryPhrase);
        setStep(S.RECOVERY);
        setInput("");
      } else {
        setUser({ id: u.id, username: u.username, name: u.name });
        addLine("output", COPY.allSet);
        setDone(true);
      }
    } catch (e) {
      addLine("error", e instanceof Error ? e.message : "Error");
    }
  };

  // --- Handlers ---

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") submit();
    if (e.key === "Escape") goBack();
  };

  const focusInput = () => inputRef.current?.focus();

  const copyPhrase = () => {
    if (!recoveryPhrase) return;
    navigator.clipboard.writeText(recoveryPhrase);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // --- Render ---

  const inputEl = (
    <input
      ref={inputRef}
      value={input}
      onChange={(e) => setInput(e.target.value)}
      onKeyDown={handleKey}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      type={cur.password ? "password" : "text"}
      placeholder={cur.placeholder}
      disabled={isRevealing}
      spellCheck={false}
      autoComplete="off"
      className="flex-1 bg-transparent outline-none text-text font-sans placeholder:text-text/15"
    />
  );

  const inputRow = (
    <div className="flex items-center gap-2 text-base border-b border-text/5 pb-1 focus-within:border-text/20 transition-colors">
      {step > S.NAME && (
        <span className="text-text/15 shrink-0 text-xs cursor-pointer hover:text-text/30 transition-colors" onClick={goBack}>‹</span>
      )}
      {inputEl}
      <span className="animate-cursor text-text/30 shrink-0">_</span>
    </div>
  );

  return (
    <div className="h-screen w-screen bg-bg text-text text-sm relative overflow-hidden cursor-text" onClick={focusInput}>

      {/* Symbol */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
        <pre className="text-xs whitespace-pre leading-none text-text/70">
          {animaSymbol}
        </pre>
      </div>

      {/* Version */}
      {lines[0]?.type === "output" && lines[0]?.text.startsWith("ANIMA OS") && (
        <div className="absolute top-6 left-0 right-0 text-center z-10 text-text/60 font-sans font-medium tracking-[0.3em] text-xs uppercase">
          {lines[0].revealed}
        </div>
      )}

      {/* Terminal */}
      <div className="absolute bottom-0 left-0 right-0 z-10 pb-10 px-8">
        <div className="max-w-md mx-auto font-mono text-sm">

          {step === S.RECOVERY && recoveryPhrase ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <div className="text-text/50 text-sm font-sans">{COPY.recoveryLabel}</div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); copyPhrase(); }}
                  className="text-text/25 hover:text-text/50 text-xs font-mono transition-colors"
                >
                  {copied ? "copied" : "copy"}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-x-6 gap-y-1.5 mb-4">
                {recoveryPhrase.split(" ").map((word, i) => (
                  <div key={i} className="text-text/80">
                    <span className="text-text/30 mr-1.5">{String(i + 1).padStart(2)}</span>
                    {word}
                  </div>
                ))}
              </div>
              <div className="text-text/40 text-xs mb-3">{COPY.recoveryWarning}</div>

              {lastError && (
                <div key={lastError.id} className="text-text/35 mb-1 animate-fade-in">! {lastError.revealed}</div>
              )}

              <div className="flex items-center gap-2 border-b border-text/5 pb-1 focus-within:border-text/20 transition-colors" ref={bottomRef}>
                {inputEl}
                <span className="animate-cursor text-text/30 shrink-0">_</span>
              </div>
            </>
          ) : (
            <>
              {historyPairs.length > 0 && (
                <div className="space-y-0.5 mb-3">
                  {historyPairs.map(({ question, answer }) => (
                    <div key={question.id}>
                      <div className="text-text/15 font-sans">{question.text}</div>
                      <div className="text-text/25 pl-3 font-sans">{answer.text}</div>
                    </div>
                  ))}
                </div>
              )}

              {lastQuestion && (
                <div key={lastQuestion.id} className="text-text/75 text-xl font-sans mb-3 animate-fade-in">
                  {lastQuestion.revealed}
                </div>
              )}

              {lastError && (
                <div key={lastError.id} className="text-text/35 mb-1 animate-fade-in">! {lastError.revealed}</div>
              )}

              <div className="animate-fade-in" key={step} ref={bottomRef}>
                {!done && !booting ? (
                  inputRow
                ) : done ? (
                  <span className="text-text/40 font-sans text-sm tracking-wide">continue →</span>
                ) : (
                  <span className="text-text/20 animate-pulse">...</span>
                )}
              </div>
            </>
          )}

          {/* Progress dots */}
          {!done && !booting && (
            <div className="flex items-center justify-center gap-1.5 mt-6">
              {STEPS.slice(0, S.CONFIRM + 1).map((_, i) => (
                <div
                  key={i}
                  className={`w-1 h-1 rounded-full transition-colors ${
                    i === step ? "bg-text/40" : i < step ? "bg-text/15" : "bg-text/5"
                  }`}
                />
              ))}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

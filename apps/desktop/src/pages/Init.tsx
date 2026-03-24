import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Navigate } from "react-router-dom";
import { api, setUnlockToken } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useAnimaSymbol } from "../lib/ascii-art";
import pkg from "../../package.json";

interface Line {
  id: number;
  type: "output" | "input" | "error";
  text: string;
  revealed: string;
}

const STEP = { NAME: 0, USERNAME: 1, PASSWORD: 2, VERIFY: 3, AGENT: 4, CONFIRM: 5, RECOVERY: 6 } as const;
const STEP_LABELS = ["name", "username", "password", "verify", "agent", "confirm", "recovery"];
const PASSWORD_STEPS: Set<number> = new Set([STEP.PASSWORD, STEP.VERIFY]);

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

export default function Init() {
  const { isProvisioned, setUser } = useAuth();
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [step, setStep] = useState(0);
  const [booting, setBooting] = useState(true);
  const [data, setData] = useState({ name: "", username: "", password: "", agent: "" });
  const [done, setDone] = useState(false);
  const [recoveryPhrase, setRecoveryPhrase] = useState<string | null>(null);
  const [pendingUser, setPendingUser] = useState<{ id: number; username: string; name: string } | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  const animaSymbol = useAnimaSymbol(getSymbolSpeed(done, input.length, isFocused));
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);

  // Typewriter: reveal one character per tick
  useEffect(() => {
    const hasUnrevealed = lines.some((l) => l.revealed.length < l.text.length);
    if (!hasUnrevealed) return;

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
  }, [lines]);

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
    if (!booting && !done) inputRef.current?.focus();
  }, [booting, done, step]);

  if (isProvisioned) return <Navigate to="/login" replace />;

  const next = () => {
    setStep((s) => s + 1);
    setInput("");
  };

  const submit = () => {
    if (!input.trim() || done) return;
    const v = input.trim();
    addLine("input", `> ${PASSWORD_STEPS.has(step) ? "*".repeat(v.length) : v}`);

    switch (step) {
      case STEP.NAME:
        setData((d) => ({ ...d, name: v }));
        addLine("output", COPY.greetAndUsername(v));
        next();
        break;
      case STEP.USERNAME:
        if (v.length < 2) return addLine("error", COPY.errTooShort);
        setData((d) => ({ ...d, username: v }));
        addLine("output", COPY.askPassword);
        next();
        break;
      case STEP.PASSWORD:
        if (v.length < 6) return addLine("error", COPY.errMinChars);
        setData((d) => ({ ...d, password: v }));
        addLine("output", COPY.confirmPassword);
        next();
        break;
      case STEP.VERIFY:
        if (v !== data.password) return addLine("error", COPY.errNoMatch);
        addLine("output", COPY.askAgent);
        next();
        break;
      case STEP.AGENT: {
        const agent = v || "Anima";
        setData((d) => ({ ...d, agent }));
        addLine("output", COPY.summary(data.name, data.username, agent));
        addLine("output", COPY.confirmCreate);
        next();
        break;
      }
      case STEP.CONFIRM:
        if (v.toLowerCase() !== "yes") {
          addLine("error", COPY.errCancelled);
          return;
        }
        addLine("output", COPY.creating);
        create();
        break;
      case STEP.RECOVERY:
        if (v.toLowerCase() !== "saved") {
          addLine("error", COPY.errSaveFirst);
          return;
        }
        if (pendingUser) setUser(pendingUser);
        addLine("output", COPY.allSet);
        setDone(true);
        break;
    }
  };

  const create = async () => {
    try {
      const u = await api.auth.register(
        data.username,
        data.password,
        data.name,
        "default",
        data.agent || "Anima",
        "",
        "companion",
      );
      setUnlockToken(u.unlockToken);

      if (u.recoveryPhrase) {
        setPendingUser({ id: u.id, username: u.username, name: u.name });
        setRecoveryPhrase(u.recoveryPhrase);
        setStep(STEP.RECOVERY);
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

  const lastQuestionIdx = lines.reduce(
    (acc, l, i) => (l.type === "output" && i > 0 ? i : acc),
    -1,
  );
  const errorLine = [...lines].reverse().find((l) => l.type === "error");

  const historyPairs = useMemo(
    () =>
      lines
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => l.type === "input")
        .map(({ l: answer, i }) => {
          const question = [...lines.slice(1, i)].reverse().find((x) => x.type === "output");
          return question ? { question, answer } : null;
        })
        .filter(Boolean)
        .slice(-2) as { question: Line; answer: Line }[],
    [lines],
  );

  const handleKey = (e: React.KeyboardEvent) => e.key === "Enter" && submit();
  const onFocus = () => setIsFocused(true);
  const onBlur = () => setIsFocused(false);

  const inputProps = {
    ref: inputRef,
    value: input,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setInput(e.target.value),
    onKeyDown: handleKey,
    onFocus,
    onBlur,
    className: "flex-1 bg-transparent outline-none text-white",
    spellCheck: false,
    autoComplete: "off",
  } as const;

  return (
    <div className="h-screen w-screen bg-black text-white text-sm relative overflow-hidden">
      {/* CRT scanline overlay */}
      <div
        className="absolute inset-0 pointer-events-none z-20"
        style={{
          background:
            "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.04) 2px, rgba(0,0,0,0.04) 4px)",
        }}
      />
      {/* Vignette */}
      <div
        className="absolute inset-0 pointer-events-none z-20"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.5) 100%)",
        }}
      />

      {/* Symbol — always centered */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
        <pre className="text-xs whitespace-pre leading-none text-white/70">
          {animaSymbol}
        </pre>
      </div>

      {/* Version — pinned to top */}
      {lines[0]?.type === "output" && lines[0]?.text.startsWith("ANIMA OS") && (
        <div className="absolute top-6 left-0 right-0 text-center z-10 text-white tracking-widest text-xs">
          {lines[0].revealed}
        </div>
      )}

      {/* Terminal */}
      <div className="absolute bottom-0 left-0 right-0 z-10 pb-10 px-8">
        <div className="max-w-md mx-auto font-mono text-sm">

          {step === STEP.RECOVERY && recoveryPhrase ? (
            <>
              <div className="mb-3 text-white/50 text-xs">{COPY.recoveryLabel}</div>
              <div className="grid grid-cols-3 gap-x-6 gap-y-1.5 mb-4">
                {recoveryPhrase.split(" ").map((word, i) => (
                  <div key={i} className="text-white/80">
                    <span className="text-white/30 mr-1.5">{String(i + 1).padStart(2)}</span>
                    {word}
                  </div>
                ))}
              </div>
              <div className="text-white/40 text-xs mb-3">{COPY.recoveryWarning}</div>

              {errorLine && (
                <div key={errorLine.id} className="text-white/35 mb-1">! {errorLine.revealed}</div>
              )}

              <div className="flex items-center gap-2" ref={bottomRef}>
                <span className="text-white/25 shrink-0 text-xs">recovery</span>
                <span className="text-white/40 shrink-0">›</span>
                <input {...inputProps} type="text" placeholder="type 'saved' when done" />
                <span className="animate-cursor text-white/30 shrink-0">_</span>
              </div>
            </>
          ) : (
            <>
              {historyPairs.length > 0 && (
                <div className="space-y-0.5 mb-3">
                  {historyPairs.map(({ question, answer }) => (
                    <div key={question.id}>
                      <div className="text-white/15">{question.text}</div>
                      <div className="text-white/25 pl-3">{answer.text}</div>
                    </div>
                  ))}
                </div>
              )}

              {lastQuestionIdx >= 0 && (
                <div key={lines[lastQuestionIdx].id} className="text-white/75 mb-1">
                  {lines[lastQuestionIdx].revealed}
                </div>
              )}

              {errorLine && (
                <div key={errorLine.id} className="text-white/35 mb-1">! {errorLine.revealed}</div>
              )}

              <div className="flex items-center gap-2" ref={bottomRef}>
                {!done && !booting ? (
                  <>
                    <span className="text-white/25 shrink-0 text-xs">{STEP_LABELS[step]}</span>
                    <span className="text-white/40 shrink-0">›</span>
                    <input {...inputProps} type={PASSWORD_STEPS.has(step) ? "password" : "text"} />
                    <span className="animate-cursor text-white/30 shrink-0">_</span>
                  </>
                ) : done ? (
                  <a href="/" className="text-white/40 hover:text-white transition-colors">[continue]</a>
                ) : (
                  <span className="text-white/20 animate-pulse">...</span>
                )}
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}

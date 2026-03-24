import { useState, useEffect, useRef, useCallback } from "react";
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

const STEP_LABELS = [
  "NAME",
  "USERNAME",
  "PASSWORD",
  "VERIFY",
  "AGENT",
  "CONFIRM",
  "RECOVERY",
];

export default function Init() {
  const { isProvisioned, setUser } = useAuth();
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [step, setStep] = useState(0);
  const [booting, setBooting] = useState(true);
  const [data, setData] = useState({
    name: "",
    username: "",
    password: "",
    agent: "",
    persona: "default",
  });
  const [done, setDone] = useState(false);
  const [recoveryPhrase, setRecoveryPhrase] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  // Remove logoVisible, add firstLineVisible
  // Track which non-question output lines should be visible
  const [vanishingLines, setVanishingLines] = useState<{
    [id: number]: boolean;
  }>({});
  // Hide each non-question output line after it is fully revealed
  useEffect(() => {
    lines.forEach((l, i) => {
      if (
        l.type === "output" &&
        l.text.trim() !== "" &&
        !l.text.trim().endsWith("?") &&
        !l.text.trim().toLowerCase().endsWith("(yes)") &&
        l.revealed === l.text &&
        vanishingLines[l.id] !== false
      ) {
        setTimeout(
          () => {
            setVanishingLines((prev) => ({ ...prev, [l.id]: false }));
          },
          600 + i * 60,
        ); // stagger a bit for effect
      }
    });
  }, [lines, vanishingLines]);
  const symbolSpeed = done ? 4 : input.length > 0 ? 2.5 : isFocused ? 1.6 : 1;
  const animaSymbol = useAnimaSymbol(symbolSpeed);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);

  // Typewriter: reveal characters on lines that aren't fully shown yet
  useEffect(() => {
    const hasUnrevealed = lines.some((l) => l.revealed.length < l.text.length);
    if (!hasUnrevealed) return;

    const t = setTimeout(() => {
      setLines((prev) =>
        prev.map((l) => {
          if (l.revealed.length < l.text.length) {
            return { ...l, revealed: l.text.slice(0, l.revealed.length + 1) };
          }
          return l;
        }),
      );
    }, 18);
    return () => clearTimeout(t);
  }, [lines]);

  const addLine = useCallback((type: Line["type"], text: string) => {
    const instant = type === "input";
    setLines((p) => [
      ...p,
      { id: idRef.current++, type, text, revealed: instant ? text : "" },
    ]);
  }, []);

  useEffect(() => {
    addLine("output", `ANIMA OS v${pkg.version}`);
    setTimeout(() => {
      addLine("output", "What's your name?");
      setBooting(false);
    }, 600);
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  useEffect(() => {
    if (!booting) inputRef.current?.focus();
  });

  if (isProvisioned) return <Navigate to="/login" replace />;

  const next = () => {
    setStep((s) => s + 1);
    setInput("");
  };

  const submit = () => {
    if (!input.trim() || done) return;
    const v = input.trim();
    addLine("input", `> ${step === 2 || step === 3 ? "*".repeat(v.length) : v}`);

    switch (step) {
      case 0:
        if (!v) return addLine("error", "Required");
        setData((d) => ({ ...d, name: v }));
        addLine("output", `Nice to meet you, ${v}. Pick a username.`);
        next();
        break;
      case 1:
        if (v.length < 2) return addLine("error", "Too short");
        setData((d) => ({ ...d, username: v }));
        addLine("output", "Good. Now a password — at least 6 characters.");
        next();
        break;
      case 2:
        if (v.length < 6) return addLine("error", "Min 6 chars");
        setData((d) => ({ ...d, password: v }));
        addLine("output", "One more time — just to be sure.");
        next();
        break;
      case 3:
        if (v !== data.password) return addLine("error", "Doesn't match. Try again.");
        addLine("output", "What would you like to call me?");
        next();
        break;
      case 4: {
        const agent = v || "Anima";
        setData((d) => ({ ...d, agent }));
        addLine("output", `${data.name} · ${data.username} · ${agent}`);
        addLine("output", "Ready to go? Type yes to create your account.");
        next();
        break;
      }
      case 5:
        if (v.toLowerCase() !== "yes") {
          addLine("error", "Cancelled");
          return;
        }
        addLine("output", "Setting things up...");
        create();
        break;
      case 6:
        if (v.toLowerCase() !== "saved") {
          addLine("error", "Type 'saved' when you've written it down.");
          return;
        }
        addLine("output", "You're all set.");
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
        data.persona as "default" | "companion",
        data.agent || "Anima",
        "",
        "companion",
      );
      setUnlockToken(u.unlockToken);
      setUser({ id: u.id, username: u.username, name: u.name });

      // Show recovery phrase
      if (u.recoveryPhrase) {
        setRecoveryPhrase(u.recoveryPhrase);
        setStep(6);
        setInput("");
      } else {
        addLine("output", "Done.");
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

  // Build Q&A pairs for history display
  const historyPairs = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => l.type === "input")
    .map(({ l: answer, i }) => {
      const question = [...lines.slice(1, i)].reverse().find(
        (x) => x.type === "output"
      );
      return question ? { question, answer } : null;
    })
    .filter(Boolean)
    .slice(-2) as { question: Line; answer: Line }[];

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

          {step === 6 && recoveryPhrase ? (
            <>
              {/* Recovery phrase display */}
              <div className="mb-3 text-white/50 text-xs">Your recovery phrase:</div>
              <div className="grid grid-cols-3 gap-x-6 gap-y-1.5 mb-4">
                {recoveryPhrase.split(" ").map((word, i) => (
                  <div key={i} className="text-white/80">
                    <span className="text-white/30 mr-1.5">{String(i + 1).padStart(2)}</span>
                    {word}
                  </div>
                ))}
              </div>
              <div className="text-white/40 text-xs mb-3">
                Write this down. It's the only way to recover your account.
              </div>

              {/* Error */}
              {errorLine && (
                <div key={errorLine.id} className="text-white/35 mb-1">
                  ! {errorLine.revealed}
                </div>
              )}

              {/* Input — type "saved" */}
              <div className="flex items-center gap-2" ref={bottomRef}>
                <span className="text-white/25 shrink-0 text-xs">recovery</span>
                <span className="text-white/40 shrink-0">›</span>
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
                  className="flex-1 bg-transparent outline-none text-white"
                  placeholder="type 'saved' when done"
                  spellCheck={false}
                  autoComplete="off"
                />
                <span className="animate-cursor text-white/30 shrink-0">_</span>
              </div>
            </>
          ) : (
            <>
              {/* Q&A history */}
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

              {/* Current question */}
              {lastQuestionIdx >= 0 && (
                <div key={lines[lastQuestionIdx].id} className="text-white/75 mb-1">
                  {lines[lastQuestionIdx].revealed}
                </div>
              )}

              {/* Error */}
              {errorLine && (
                <div key={errorLine.id} className="text-white/35 mb-1">
                  ! {errorLine.revealed}
                </div>
              )}

              {/* Input line */}
              <div className="flex items-center gap-2" ref={bottomRef}>
                {!done && !booting ? (
                  <>
                    <span className="text-white/25 shrink-0 text-xs">{STEP_LABELS[step]?.toLowerCase()}</span>
                    <span className="text-white/40 shrink-0">›</span>
                    <input
                      ref={inputRef}
                      type={step === 2 || step === 3 ? "password" : "text"}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && submit()}
                      onFocus={() => setIsFocused(true)}
                      onBlur={() => setIsFocused(false)}
                      className="flex-1 bg-transparent outline-none text-white"
                      spellCheck={false}
                      autoComplete="off"
                    />
                    <span className="animate-cursor text-white/30 shrink-0">_</span>
                  </>
                ) : done ? (
                  <a href="/" className="text-white/40 hover:text-white transition-colors">
                    [continue]
                  </a>
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

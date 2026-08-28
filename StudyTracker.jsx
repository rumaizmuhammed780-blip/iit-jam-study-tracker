import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabase";
import {
  CheckCircle2,
  Circle,
  AlertTriangle,
  PiggyBank,
  History,
  Plus,
  X,
  Play,
  Square,
  Timer,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_NAMES_SHORT = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ---------- Schedule templates ----------

// Supabase helpers
async function getCloudDay(userId, dateStr) {
  const { data, error } = await supabase
    .from("study_days")
    .select("day_type, record")
    .eq("user_id", userId)
    .eq("study_date", dateStr)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function saveCloudDay(userId, dateStr, record) {
  const { error } = await supabase.from("study_days").upsert(
    {
      user_id: userId,
      study_date: dateStr,
      day_type: record.dayType,
      record,
    },
    { onConflict: "user_id,study_date" }
  );
  if (error) throw error;
}

const SCHEDULES = {
  weekday: {
    label: "WEEKDAY",
    targetHours: 6.5,
    blocks: [
      { id: "b1", label: "Study Block 1", time: "9:00 – 11:00 AM", end: 660 },
      { id: "b2", label: "Study Block 2", time: "11:15 AM – 1:00 PM", end: 780 },
      { id: "py", label: "Python Practice", time: "2:00 – 3:30 PM", end: 930 },
      { id: "b3", label: "Study Block 3", time: "3:45 – 5:00 PM", end: 1020 },
      { id: "rev", label: "Revision Buffer", time: "7:30 – 9:00 PM", end: 1260 },
    ],
  },
  friday: {
    label: "FRIDAY",
    targetHours: 4.25,
    blocks: [
      { id: "b1", label: "Study Block 1", time: "9:00 – 11:00 AM", end: 660 },
      { id: "b2", label: "Study Block 2", time: "11:15 AM – 12:00 PM", end: 720 },
      { id: "prayer", label: "Prayer", time: "12:00 – 2:00 PM", end: 840, nonStudy: true },
      { id: "py", label: "Python Practice", time: "2:15 – 3:45 PM", end: 945 },
      { id: "b3", label: "Study Block 3", time: "4:00 – 5:30 PM", end: 1050 },
      { id: "rev", label: "Revision Buffer", time: "7:30 – 9:00 PM", end: 1260 },
    ],
  },
  weekend: {
    label: "WEEKEND",
    targetHours: 3.25,
    blocks: [
      { id: "b1", label: "Study Block 1", time: "9:00 – 10:30 AM", end: 630 },
      { id: "py", label: "Python Practice", time: "10:45 – 11:30 AM", end: 690 },
      { id: "holiday", label: "Holiday Block", time: "11:30 AM – 5:00 PM", end: 1020, nonStudy: true },
      { id: "b2", label: "Study Block 2", time: "5:00 – 6:00 PM", end: 1080 },
    ],
  },
};

const PENALTY_OPTIONS = [
  { id: "no-treat", label: "Skip dessert/snack", amount: 0 },
  { id: "no-favfood", label: "No favorite food today", amount: 0 },
  { id: "piggy-20", label: "Piggy bank ₹20", amount: 20 },
  { id: "piggy-50", label: "Piggy bank ₹50", amount: 50 },
  { id: "piggy-100", label: "Piggy bank ₹100", amount: 100 },
];

function pad(n) {
  return String(n).padStart(2, "0");
}
function dateStrOf(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function dayTypeOf(d) {
  const day = d.getDay();
  if (day === 5) return "friday";
  if (day === 0 || day === 6) return "weekend";
  return "weekday";
}
function fmtClock(d) {
  let h = d.getHours();
  const m = pad(d.getMinutes());
  const s = pad(d.getSeconds());
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${pad(h)}:${m}:${s} ${ampm}`;
}
function fmtTime(ts) {
  const d = new Date(ts);
  let h = d.getHours();
  const m = pad(d.getMinutes());
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${pad(h)}:${m} ${ampm}`;
}
function fmtDuration(ms) {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}
function fmtHours(ms) {
  return (ms / 3600000).toFixed(1);
}
function fmtFullDate(d) {
  return `${DAY_NAMES[d.getDay()]}, ${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}
function dayStatus(rec) {
  if (!rec) return "none";
  const tmplR = SCHEDULES[rec.dayType];
  const ms = rec.sessions.reduce(
    (s, sess) => (sess.end ? s + (sess.end - sess.start) : s),
    0
  );
  const hours = ms / 3600000;
  const doneCount = rec.blocks.filter((b) => b.done).length;
  if ((rec.punishments || []).length > 0) return "penalty";
  if (hours >= tmplR.targetHours) return "complete";
  if (hours > 0 || doneCount > 0) return "partial";
  return "empty";
}

function defaultDayRecord(dateStr) {
  const dt = dayTypeOf(new Date(dateStr + "T12:00:00"));
  const tmpl = SCHEDULES[dt];
  return {
    dayType: dt,
    blocks: tmpl.blocks.map((b) => ({ id: b.id, done: false })),
    sessions: [],
    punishments: [],
  };
}

function AuthScreen() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      if (mode === "login") {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) throw signUpError;
        if (!data.session) {
          setMessage("Account created. Check your email to confirm your account, then log in.");
        }
      }
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={styles.root}>
      <FontImport />
      <div style={{ ...styles.panel, marginTop: 60 }}>
        <div style={styles.eyebrow}>IIT JAM — TIME CLOCK</div>
        <div style={{ ...styles.panelTitle, fontSize: 22, marginBottom: 8 }}>
          {mode === "login" ? "Welcome back" : "Create your account"}
        </div>
        <div style={{ ...styles.monoMuted, marginBottom: 18 }}>
          Your study progress will sync across your devices.
        </div>
        <form onSubmit={submit}>
          <input
            style={{ ...styles.customInput, width: "100%", marginBottom: 10 }}
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            style={{ ...styles.customInput, width: "100%", marginBottom: 12 }}
            type="password"
            placeholder="Password (at least 6 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
          />
          <button
            type="submit"
            disabled={busy}
            style={{ ...styles.punchBtn, ...styles.punchBtnIn, opacity: busy ? 0.6 : 1 }}
          >
            {busy ? "PLEASE WAIT…" : mode === "login" ? "LOG IN" : "SIGN UP"}
          </button>
        </form>
        {error && <div style={{ color: "var(--ink)", fontSize: 12, marginTop: 12 }}>{error}</div>}
        {message && <div style={{ color: "var(--success)", fontSize: 12, marginTop: 12 }}>{message}</div>}
        <button
          onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); setMessage(""); }}
          style={{ ...styles.manualPenaltyBtn, marginTop: 14 }}
        >
          {mode === "login" ? "Create a new account" : "I already have an account"}
        </button>
      </div>
    </div>
  );
}

export default function StudyTracker() {
  const [now, setNow] = useState(new Date());
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [tab, setTab] = useState("today");
  const [loading, setLoading] = useState(true);
  const [record, setRecord] = useState(null);
  const [dateStr] = useState(dateStrOf(new Date()));
  const [penaltyTarget, setPenaltyTarget] = useState(null); // blockId or "manual" or null
  const [customNote, setCustomNote] = useState("");
  const [history, setHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [piggyLoading, setPiggyLoading] = useState(false);
  const [allPunishments, setAllPunishments] = useState(null);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [calendarData, setCalendarData] = useState({});
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [selectedDay, setSelectedDay] = useState(null); // { dateStr, record } | null
  const saveRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setUser(data.session?.user ?? null);
        setAuthLoading(false);
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  // live clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Load today's record from Supabase
  useEffect(() => {
    if (!user) {
      setRecord(null);
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      try {
        const data = await getCloudDay(user.id, dateStr);
        setRecord(data?.record ?? defaultDayRecord(dateStr));
      } catch (e) {
        console.error("Load failed", e);
        setRecord(defaultDayRecord(dateStr));
      } finally {
        setLoading(false);
      }
    })();
  }, [dateStr, user]);

  const persist = useCallback(
    async (next) => {
      setRecord(next);
      if (!user) return;
      try {
        await saveCloudDay(user.id, dateStr, next);
      } catch (e) {
        console.error("Save failed", e);
        alert("Could not save your progress. Please check your internet connection and try again.");
      }
    },
    [dateStr, user]
  );

  const loadHistory = useCallback(async () => {
    if (!user) return;
    setHistoryLoading(true);
    try {
      const { data, error } = await supabase
        .from("study_days")
        .select("study_date, day_type, record")
        .eq("user_id", user.id)
        .order("study_date", { ascending: false })
        .limit(15);
      if (error) throw error;
      setHistory((data || [])
        .filter((r) => r.study_date !== dateStr)
        .slice(0, 14)
        .map((r) => ({ date: r.study_date, dayType: r.day_type, ...r.record })));
    } catch (e) {
      console.error("History load failed", e);
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [dateStr, user]);

  const loadPiggy = useCallback(async () => {
    if (!user) return;
    setPiggyLoading(true);
    try {
      const { data, error } = await supabase
        .from("study_days")
        .select("study_date, record")
        .eq("user_id", user.id)
        .order("study_date", { ascending: false });
      if (error) throw error;
      const all = [];
      (data || []).forEach((row) => {
        (row.record?.punishments || []).forEach((p) => all.push({ ...p, date: row.study_date }));
      });
      all.sort((a, b) => (a.time < b.time ? 1 : -1));
      setAllPunishments(all);
    } catch (e) {
      console.error("Piggy load failed", e);
      setAllPunishments([]);
    } finally {
      setPiggyLoading(false);
    }
  }, [user]);

  const loadCalendarMonth = useCallback(async (monthDate) => {
    if (!user) return;
    setCalendarLoading(true);
    try {
      const year = monthDate.getFullYear();
      const month = monthDate.getMonth();
      const first = `${year}-${pad(month + 1)}-01`;
      const last = `${year}-${pad(month + 1)}-${pad(new Date(year, month + 1, 0).getDate())}`;
      const { data, error } = await supabase
        .from("study_days")
        .select("study_date, day_type, record")
        .eq("user_id", user.id)
        .gte("study_date", first)
        .lte("study_date", last);
      if (error) throw error;
      const mapped = {};
      (data || []).forEach((row) => {
        mapped[row.study_date] = { dayType: row.day_type, ...row.record };
      });
      setCalendarData(mapped);
    } catch (e) {
      console.error("Calendar load failed", e);
      setCalendarData({});
    } finally {
      setCalendarLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (tab === "history") loadHistory();
    if (tab === "piggy") loadPiggy();
    if (tab === "calendar") loadCalendarMonth(calendarMonth);
  }, [tab, user, loadHistory, loadPiggy, loadCalendarMonth, calendarMonth]);

  if (authLoading) {
    return (
      <div style={styles.root}>
        <FontImport />
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Checking your account…</div>
      </div>
    );
  }

  if (!user) return <AuthScreen />;

  if (loading || !record) {
    return (
      <div style={styles.root}>
        <FontImport />
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
          Warming up the time clock…
        </div>
      </div>
    );
  }

  const tmpl = SCHEDULES[record.dayType];
  const openSession = record.sessions.find((s) => !s.end);
  const closedMs = record.sessions.reduce(
    (sum, s) => (s.end ? sum + (s.end - s.start) : sum),
    0
  );
  const liveMs = openSession ? now.getTime() - openSession.start : 0;
  const totalMs = closedMs + liveMs;
  const totalHours = totalMs / 3600000;
  const progressPct = Math.min(100, (totalHours / tmpl.targetHours) * 100);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  function handlePunch() {
    const sessions = [...record.sessions];
    if (openSession) {
      const idx = sessions.findIndex((s) => !s.end);
      sessions[idx] = { ...sessions[idx], end: Date.now() };
    } else {
      sessions.push({ start: Date.now(), end: null });
    }
    persist({ ...record, sessions });
  }

  function toggleBlock(id) {
    const blocks = record.blocks.map((b) =>
      b.id === id ? { ...b, done: !b.done } : b
    );
    persist({ ...record, blocks });
  }

  function applyPenalty(option) {
    const block = tmpl.blocks.find((b) => b.id === penaltyTarget);
    const entry = {
      id: `${Date.now()}`,
      time: new Date().toISOString(),
      blockId: block ? block.id : null,
      blockLabel: block ? block.label : "General",
      type: option.id,
      note: option.label,
      amount: option.amount,
    };
    persist({ ...record, punishments: [...record.punishments, entry] });
    setPenaltyTarget(null);
  }

  function applyCustomPenalty() {
    if (!customNote.trim()) return;
    const block = tmpl.blocks.find((b) => b.id === penaltyTarget);
    const entry = {
      id: `${Date.now()}`,
      time: new Date().toISOString(),
      blockId: block ? block.id : null,
      blockLabel: block ? block.label : "General",
      type: "custom",
      note: customNote.trim(),
      amount: 0,
    };
    persist({ ...record, punishments: [...record.punishments, entry] });
    setCustomNote("");
    setPenaltyTarget(null);
  }

  const todaysPiggy = record.punishments.reduce((s, p) => s + (p.amount || 0), 0);

  return (
    <div style={styles.root}>
      <FontImport />

      <div style={styles.header}>
        <div>
          <div style={styles.eyebrow}>IIT JAM — TIME CLOCK</div>
          <div style={styles.bigClock}>{fmtClock(now)}</div>
          <div style={styles.fullDate}>{fmtFullDate(now)}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
          <div style={styles.dayBadge}>{tmpl.label}</div>
          <button
            onClick={() => supabase.auth.signOut()}
            style={{ ...styles.logPenaltyBtn, color: "var(--text-muted)", borderColor: "#3A3428" }}
          >
            LOG OUT
          </button>
        </div>
      </div>

      <div style={styles.tabs}>
        {[
          { id: "today", label: "TODAY", icon: Timer },
          { id: "calendar", label: "CALENDAR", icon: CalendarDays },
          { id: "history", label: "HISTORY", icon: History },
          { id: "piggy", label: "PIGGY BANK", icon: PiggyBank },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              ...styles.tabBtn,
              ...(tab === t.id ? styles.tabBtnActive : {}),
            }}
          >
            <t.icon size={14} style={{ marginRight: 6 }} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "today" && (
        <div>
          {/* Punch card */}
          <div style={styles.panel}>
            <div style={styles.panelTitleRow}>
              <span style={styles.panelTitle}>Punch Clock</span>
              <span style={styles.monoMuted}>
                {fmtHours(totalMs)} / {tmpl.targetHours} hrs
              </span>
            </div>
            <div style={styles.progressTrack}>
              <div
                style={{
                  ...styles.progressFill,
                  width: `${progressPct}%`,
                }}
              />
            </div>
            <button
              onClick={handlePunch}
              style={{
                ...styles.punchBtn,
                ...(openSession ? styles.punchBtnOut : styles.punchBtnIn),
              }}
            >
              {openSession ? <Square size={18} /> : <Play size={18} />}
              {openSession ? "PUNCH OUT" : "PUNCH IN"}
            </button>
            {openSession && (
              <div style={styles.liveTimer}>
                running · {fmtDuration(liveMs)}
              </div>
            )}

            {record.sessions.length > 0 && (
              <div style={styles.stampList}>
                {record.sessions
                  .slice()
                  .reverse()
                  .map((s, i) => (
                    <div key={i} style={styles.stampRow}>
                      <span style={styles.stampIn}>IN {fmtTime(s.start)}</span>
                      <span style={styles.stampArrow}>→</span>
                      {s.end ? (
                        <>
                          <span style={styles.stampOut}>OUT {fmtTime(s.end)}</span>
                          <span style={styles.monoMuted}>
                            {fmtDuration(s.end - s.start)}
                          </span>
                        </>
                      ) : (
                        <span style={styles.stampLive}>ongoing…</span>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Blocks */}
          <div style={styles.panel}>
            <div style={styles.panelTitleRow}>
              <span style={styles.panelTitle}>Today's Blocks</span>
              {todaysPiggy > 0 && (
                <span style={styles.monoMuted}>₹{todaysPiggy} logged today</span>
              )}
            </div>
            {tmpl.blocks.map((b) => {
              const state = record.blocks.find((x) => x.id === b.id);
              const done = state && state.done;
              const missed = !done && !b.nonStudy && nowMinutes > b.end;
              return (
                <div key={b.id} style={styles.blockRow}>
                  <button
                    onClick={() => toggleBlock(b.id)}
                    style={styles.checkBtn}
                    aria-label={done ? "Mark incomplete" : "Mark complete"}
                  >
                    {done ? (
                      <CheckCircle2 size={20} color="var(--success)" />
                    ) : (
                      <Circle size={20} color="var(--text-muted)" />
                    )}
                  </button>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        ...styles.blockLabel,
                        ...(done ? { color: "var(--success)" } : {}),
                        ...(b.nonStudy ? { fontStyle: "italic" } : {}),
                      }}
                    >
                      {b.label}
                    </div>
                    <div style={styles.blockTime}>{b.time}</div>
                  </div>
                  {missed && (
                    <div style={styles.missedGroup}>
                      <span style={styles.missedBadge}>
                        <AlertTriangle size={12} style={{ marginRight: 4 }} />
                        MISSED
                      </span>
                      <button
                        style={styles.logPenaltyBtn}
                        onClick={() => setPenaltyTarget(b.id)}
                      >
                        Log penalty
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            <button
              style={styles.manualPenaltyBtn}
              onClick={() => setPenaltyTarget("manual")}
            >
              <Plus size={14} style={{ marginRight: 6 }} />
              Log a general penalty (late sleep, etc.)
            </button>
          </div>

          {/* Today's penalty log */}
          {record.punishments.length > 0 && (
            <div style={styles.panel}>
              <div style={styles.panelTitle}>Today's Penalties</div>
              {record.punishments
                .slice()
                .reverse()
                .map((p) => (
                  <div key={p.id} style={styles.penaltyRow}>
                    <span style={styles.monoMuted}>{fmtTime(new Date(p.time).getTime())}</span>
                    <span style={{ flex: 1 }}>{p.note}</span>
                    <span style={styles.blockTag}>{p.blockLabel}</span>
                    {p.amount > 0 && <span style={styles.amountTag}>₹{p.amount}</span>}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {tab === "calendar" && (
        <div style={styles.panel}>
          <div style={styles.calendarHeader}>
            <button
              style={styles.calendarNavBtn}
              onClick={() =>
                setCalendarMonth(
                  new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1)
                )
              }
            >
              <ChevronLeft size={18} />
            </button>
            <span style={styles.panelTitle}>
              {MONTH_NAMES[calendarMonth.getMonth()]} {calendarMonth.getFullYear()}
            </span>
            <button
              style={styles.calendarNavBtn}
              onClick={() =>
                setCalendarMonth(
                  new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1)
                )
              }
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <div style={styles.calendarGridHead}>
            {DAY_NAMES_SHORT.map((d, i) => (
              <div key={i} style={styles.calendarHeadCell}>
                {d}
              </div>
            ))}
          </div>

          {calendarLoading ? (
            <div style={{ ...styles.monoMuted, padding: "20px 0", textAlign: "center" }}>
              Loading month…
            </div>
          ) : (
            <div style={styles.calendarGrid}>
              {(() => {
                const year = calendarMonth.getFullYear();
                const month = calendarMonth.getMonth();
                const firstWeekday = new Date(year, month, 1).getDay();
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                const cells = [];
                for (let i = 0; i < firstWeekday; i++) {
                  cells.push(<div key={`empty-${i}`} style={styles.calendarCellEmpty} />);
                }
                for (let day = 1; day <= daysInMonth; day++) {
                  const ds = `${year}-${pad(month + 1)}-${pad(day)}`;
                  const rec = calendarData[ds];
                  const status = dayStatus(rec);
                  const isToday = ds === dateStr;
                  cells.push(
                    <button
                      key={ds}
                      style={{
                        ...styles.calendarCell,
                        ...(isToday ? styles.calendarCellToday : {}),
                      }}
                      onClick={() => {
                        if (isToday) {
                          setTab("today");
                        } else if (rec) {
                          setSelectedDay({ dateStr: ds, record: rec });
                        }
                      }}
                    >
                      <span style={styles.calendarCellNum}>{day}</span>
                      <span
                        style={{
                          ...styles.calendarDot,
                          background: styles.dotColors[status],
                        }}
                      />
                    </button>
                  );
                }
                return cells;
              })()}
            </div>
          )}

          <div style={styles.calendarLegend}>
            <span style={styles.legendItem}>
              <span style={{ ...styles.calendarDot, background: styles.dotColors.complete }} /> Target hit
            </span>
            <span style={styles.legendItem}>
              <span style={{ ...styles.calendarDot, background: styles.dotColors.partial }} /> Partial
            </span>
            <span style={styles.legendItem}>
              <span style={{ ...styles.calendarDot, background: styles.dotColors.penalty }} /> Penalty logged
            </span>
            <span style={styles.legendItem}>
              <span style={{ ...styles.calendarDot, background: styles.dotColors.empty }} /> No progress
            </span>
          </div>
        </div>
      )}

      {tab === "history" && (
        <div style={styles.panel}>
          <div style={styles.panelTitle}>Last 14 Days</div>
          {historyLoading && <div style={styles.monoMuted}>Loading…</div>}
          {!historyLoading && history && history.length === 0 && (
            <div style={styles.monoMuted}>No past days logged yet.</div>
          )}
          {!historyLoading &&
            history &&
            history.map((h) => {
              const tmplH = SCHEDULES[h.dayType];
              const doneCount = h.blocks.filter((b) => b.done).length;
              const ms = h.sessions.reduce(
                (s, sess) => (sess.end ? s + (sess.end - sess.start) : s),
                0
              );
              const piggy = (h.punishments || []).reduce(
                (s, p) => s + (p.amount || 0),
                0
              );
              return (
                <div key={h.date} style={styles.historyRow}>
                  <div style={styles.historyDate}>{h.date}</div>
                  <div style={styles.historyTag}>{tmplH.label}</div>
                  <div style={styles.monoMuted}>
                    {fmtHours(ms)}/{tmplH.targetHours}h
                  </div>
                  <div style={styles.monoMuted}>
                    {doneCount}/{h.blocks.length} blocks
                  </div>
                  {piggy > 0 && <div style={styles.amountTag}>₹{piggy}</div>}
                </div>
              );
            })}
        </div>
      )}

      {tab === "piggy" && (
        <div style={styles.panel}>
          <div style={styles.panelTitleRow}>
            <span style={styles.panelTitle}>Piggy Bank</span>
            {allPunishments && (
              <span style={styles.piggyTotal}>
                ₹{allPunishments.reduce((s, p) => s + (p.amount || 0), 0)}
              </span>
            )}
          </div>
          {piggyLoading && <div style={styles.monoMuted}>Counting coins…</div>}
          {!piggyLoading && allPunishments && allPunishments.length === 0 && (
            <div style={styles.monoMuted}>No penalties logged yet. Keep it that way!</div>
          )}
          {!piggyLoading &&
            allPunishments &&
            allPunishments.map((p) => (
              <div key={p.id} style={styles.penaltyRow}>
                <span style={styles.monoMuted}>{p.date}</span>
                <span style={{ flex: 1 }}>{p.note}</span>
                <span style={styles.blockTag}>{p.blockLabel}</span>
                {p.amount > 0 && <span style={styles.amountTag}>₹{p.amount}</span>}
              </div>
            ))}
        </div>
      )}

      {/* Selected day summary modal (from calendar) */}
      {selectedDay && (
        <div style={styles.modalOverlay} onClick={() => setSelectedDay(null)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <span style={styles.panelTitle}>{selectedDay.dateStr}</span>
              <button style={styles.closeBtn} onClick={() => setSelectedDay(null)}>
                <X size={18} />
              </button>
            </div>
            {(() => {
              const r = selectedDay.record;
              const tmplD = SCHEDULES[r.dayType];
              const ms = r.sessions.reduce(
                (s, sess) => (sess.end ? s + (sess.end - sess.start) : s),
                0
              );
              const doneCount = r.blocks.filter((b) => b.done).length;
              const piggy = (r.punishments || []).reduce((s, p) => s + (p.amount || 0), 0);
              return (
                <div>
                  <div style={styles.summaryRow}>
                    <span style={styles.monoMuted}>Day type</span>
                    <span>{tmplD.label}</span>
                  </div>
                  <div style={styles.summaryRow}>
                    <span style={styles.monoMuted}>Hours studied</span>
                    <span>{fmtHours(ms)} / {tmplD.targetHours} hrs</span>
                  </div>
                  <div style={styles.summaryRow}>
                    <span style={styles.monoMuted}>Blocks done</span>
                    <span>{doneCount} / {r.blocks.length}</span>
                  </div>
                  <div style={styles.summaryRow}>
                    <span style={styles.monoMuted}>Penalties</span>
                    <span>{piggy > 0 ? `₹${piggy}` : "None"}</span>
                  </div>
                  {(r.punishments || []).length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      {r.punishments.map((p) => (
                        <div key={p.id} style={styles.penaltyRow}>
                          <span style={{ flex: 1 }}>{p.note}</span>
                          <span style={styles.blockTag}>{p.blockLabel}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Penalty picker modal */}
      {penaltyTarget && (
        <div style={styles.modalOverlay} onClick={() => setPenaltyTarget(null)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <span style={styles.panelTitle}>Choose a penalty</span>
              <button style={styles.closeBtn} onClick={() => setPenaltyTarget(null)}>
                <X size={18} />
              </button>
            </div>
            {PENALTY_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                style={styles.penaltyOptionBtn}
                onClick={() => applyPenalty(opt)}
              >
                {opt.label}
              </button>
            ))}
            <div style={styles.customRow}>
              <input
                style={styles.customInput}
                placeholder="Custom penalty…"
                value={customNote}
                onChange={(e) => setCustomNote(e.target.value)}
              />
              <button style={styles.customAddBtn} onClick={applyCustomPenalty}>
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FontImport() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');
    `}</style>
  );
}

const styles = {
  root: {
    "--bg": "#1C1A17",
    "--panel": "#252119",
    "--panel-alt": "#2C271E",
    "--brass": "#C6A15B",
    "--brass-bright": "#E0BE7A",
    "--ink": "#B6473F",
    "--text": "#EDE6D6",
    "--text-muted": "#9A9082",
    "--success": "#7DA070",
    background: "var(--bg)",
    color: "var(--text)",
    fontFamily: "'Inter', sans-serif",
    minHeight: "100%",
    padding: "20px 16px 40px",
    maxWidth: 520,
    margin: "0 auto",
    boxSizing: "border-box",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 18,
    borderBottom: "1px solid #3A3428",
    paddingBottom: 16,
  },
  eyebrow: {
    fontFamily: "'Oswald', sans-serif",
    fontSize: 11,
    letterSpacing: "2px",
    color: "var(--brass)",
    marginBottom: 4,
  },
  bigClock: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 28,
    fontWeight: 600,
    letterSpacing: "1px",
  },
  fullDate: {
    fontFamily: "'Oswald', sans-serif",
    fontSize: 12,
    letterSpacing: "0.5px",
    color: "var(--text-muted)",
    marginTop: 4,
  },
  dayBadge: {
    fontFamily: "'Oswald', sans-serif",
    fontSize: 12,
    letterSpacing: "1.5px",
    padding: "6px 12px",
    border: "1.5px solid var(--brass)",
    color: "var(--brass-bright)",
    transform: "rotate(3deg)",
    borderRadius: 3,
    marginTop: 4,
  },
  tabs: {
    display: "flex",
    gap: 4,
    marginBottom: 16,
  },
  tabBtn: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--panel)",
    color: "var(--text-muted)",
    border: "1px solid #3A3428",
    borderRadius: 4,
    padding: "10px 6px",
    fontFamily: "'Oswald', sans-serif",
    fontSize: 11,
    letterSpacing: "1px",
    cursor: "pointer",
  },
  tabBtnActive: {
    background: "var(--panel-alt)",
    color: "var(--brass-bright)",
    borderColor: "var(--brass)",
  },
  panel: {
    background: "var(--panel)",
    border: "1px solid #3A3428",
    borderRadius: 6,
    padding: 16,
    marginBottom: 14,
  },
  panelTitleRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  panelTitle: {
    fontFamily: "'Oswald', sans-serif",
    fontSize: 14,
    letterSpacing: "1px",
    color: "var(--text)",
  },
  monoMuted: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: "var(--text-muted)",
  },
  progressTrack: {
    height: 8,
    background: "#3A3428",
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: 16,
  },
  progressFill: {
    height: "100%",
    background: "linear-gradient(90deg, var(--brass), var(--brass-bright))",
    transition: "width 0.4s ease",
  },
  punchBtn: {
    width: "100%",
    padding: "16px",
    borderRadius: 6,
    border: "none",
    fontFamily: "'Oswald', sans-serif",
    fontSize: 16,
    letterSpacing: "2px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    cursor: "pointer",
    transition: "transform 0.1s ease",
  },
  punchBtnIn: {
    background: "var(--brass)",
    color: "#1C1A17",
  },
  punchBtnOut: {
    background: "var(--ink)",
    color: "#EDE6D6",
  },
  liveTimer: {
    textAlign: "center",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: "var(--brass-bright)",
    marginTop: 8,
  },
  stampList: {
    marginTop: 16,
    borderTop: "1px dashed #3A3428",
    paddingTop: 12,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  stampRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    flexWrap: "wrap",
  },
  stampIn: { color: "var(--brass-bright)" },
  stampOut: { color: "var(--ink)" },
  stampLive: { color: "var(--success)", fontStyle: "italic" },
  stampArrow: { color: "var(--text-muted)" },
  blockRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 0",
    borderBottom: "1px solid #322D23",
  },
  checkBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: 0,
    display: "flex",
  },
  blockLabel: {
    fontSize: 14,
    fontWeight: 500,
  },
  blockTime: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: "var(--text-muted)",
    marginTop: 2,
  },
  missedGroup: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 4,
  },
  missedBadge: {
    display: "flex",
    alignItems: "center",
    fontFamily: "'Oswald', sans-serif",
    fontSize: 10,
    letterSpacing: "1px",
    color: "var(--ink)",
  },
  logPenaltyBtn: {
    background: "none",
    border: "1px solid var(--ink)",
    color: "var(--ink)",
    borderRadius: 3,
    fontSize: 10,
    padding: "3px 8px",
    cursor: "pointer",
  },
  manualPenaltyBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    background: "none",
    border: "1px dashed #4A4335",
    color: "var(--text-muted)",
    borderRadius: 4,
    padding: "10px",
    marginTop: 12,
    fontSize: 12,
    cursor: "pointer",
  },
  penaltyRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    padding: "8px 0",
    borderBottom: "1px solid #322D23",
    flexWrap: "wrap",
  },
  blockTag: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10,
    color: "var(--text-muted)",
    border: "1px solid #3A3428",
    borderRadius: 3,
    padding: "2px 6px",
  },
  amountTag: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: "var(--brass-bright)",
    fontWeight: 600,
  },
  historyRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 0",
    borderBottom: "1px solid #322D23",
    flexWrap: "wrap",
  },
  historyDate: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    minWidth: 86,
  },
  historyTag: {
    fontFamily: "'Oswald', sans-serif",
    fontSize: 10,
    letterSpacing: "0.5px",
    color: "var(--brass)",
    border: "1px solid var(--brass)",
    borderRadius: 3,
    padding: "2px 6px",
  },
  piggyTotal: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 20,
    fontWeight: 600,
    color: "var(--brass-bright)",
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    zIndex: 50,
  },
  modal: {
    background: "var(--panel-alt)",
    border: "1px solid var(--brass)",
    borderRadius: 8,
    padding: 20,
    width: "100%",
    maxWidth: 360,
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  closeBtn: {
    background: "none",
    border: "none",
    color: "var(--text-muted)",
    cursor: "pointer",
  },
  penaltyOptionBtn: {
    display: "block",
    width: "100%",
    textAlign: "left",
    background: "var(--panel)",
    border: "1px solid #3A3428",
    color: "var(--text)",
    borderRadius: 4,
    padding: "10px 12px",
    marginBottom: 8,
    fontSize: 13,
    cursor: "pointer",
  },
  customRow: {
    display: "flex",
    gap: 6,
    marginTop: 8,
  },
  customInput: {
    flex: 1,
    background: "var(--panel)",
    border: "1px solid #3A3428",
    borderRadius: 4,
    padding: "8px 10px",
    color: "var(--text)",
    fontSize: 13,
  },
  customAddBtn: {
    background: "var(--brass)",
    color: "#1C1A17",
    border: "none",
    borderRadius: 4,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  calendarHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  calendarNavBtn: {
    background: "var(--panel-alt)",
    border: "1px solid #3A3428",
    color: "var(--brass-bright)",
    borderRadius: 4,
    padding: "6px 8px",
    cursor: "pointer",
    display: "flex",
  },
  calendarGridHead: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    marginBottom: 4,
  },
  calendarHeadCell: {
    textAlign: "center",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: "var(--text-muted)",
    padding: "4px 0",
  },
  calendarGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(7, 1fr)",
    gap: 4,
  },
  calendarCellEmpty: {},
  calendarCell: {
    aspectRatio: "1",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    background: "var(--panel-alt)",
    border: "1px solid #3A3428",
    borderRadius: 4,
    cursor: "pointer",
    padding: 0,
  },
  calendarCellToday: {
    border: "1.5px solid var(--brass)",
  },
  calendarCellNum: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 12,
    color: "var(--text)",
  },
  calendarDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    display: "inline-block",
  },
  dotColors: {
    none: "transparent",
    empty: "#4A4335",
    partial: "#C6A15B",
    complete: "#7DA070",
    penalty: "#B6473F",
  },
  calendarLegend: {
    display: "flex",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 16,
    paddingTop: 12,
    borderTop: "1px dashed #3A3428",
  },
  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: "var(--text-muted)",
  },
  summaryRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 13,
    padding: "6px 0",
    borderBottom: "1px solid #322D23",
  },
};

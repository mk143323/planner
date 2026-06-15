import React, { useState, useEffect, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom/client';

// ----------------------------- Konstante -----------------------------
const START_HOUR = 5;
const END_HOUR = 24;
const HOUR_HEIGHT = 54;
const DAY_START_MIN = START_HOUR * 60;
const DAY_END_MIN = END_HOUR * 60;
const TOTAL_HEIGHT = (END_HOUR - START_HOUR) * HOUR_HEIGHT;
const WAKE = 7 * 60;
const BED = 23 * 60;
const QUICK_START = 18 * 60; // default vrijeme za brzo prebacivanje

const PRIORITIES = {
  1: {
    label: "Hitno",
    color: "#dc2626",
    soft: "#fee2e2",
    dot: "🔴"
  },
  2: {
    label: "Visoko",
    color: "#ea580c",
    soft: "#ffedd5",
    dot: "🟠"
  },
  3: {
    label: "Srednje",
    color: "#ca8a04",
    soft: "#fef9c3",
    dot: "🟡"
  },
  4: {
    label: "Nisko",
    color: "#16a34a",
    soft: "#dcfce7",
    dot: "🟢"
  }
};
const AREAS = {
  Posao: "#4f46e5",
  Faks: "#9333ea",
  Trening: "#16a34a",
  Apartmani: "#ea580c",
  Ordio: "#db2777",
  ApartLink: "#ca8a04",
  Ostalo: "#64748b"
};
const WEEKDAYS = ["Ned", "Pon", "Uto", "Sri", "Čet", "Pet", "Sub"];
const WD_SHORT = ["P", "U", "S", "Č", "P", "S", "N"]; // pon-ned
const MONTHS = ["sij", "velj", "ožu", "tra", "svi", "lip", "srp", "kol", "ruj", "lis", "stu", "pro"];

// ----------------------------- Helperi -----------------------------
const uid = () => Math.random().toString(36).slice(2, 10);
const todayStr = () => fmtDateStr(new Date());
const parseDate = s => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const fmtDateStr = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (s, n) => {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return fmtDateStr(d);
};
const min2hhmm = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const longDate = s => {
  const d = parseDate(s);
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`;
};
const mondayOf = s => {
  const d = parseDate(s);
  const wd = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - wd);
  return fmtDateStr(d);
};
const blockEndDate = b => {
  const d = parseDate(b.date);
  d.setMinutes(b.start + b.duration);
  return d;
};
const blockIsPast = b => blockEndDate(b) < new Date();
const isSlipped = t => {
  if (t.done) return false;
  const blocks = t.blocks || [];
  if (blocks.some(b => !blockIsPast(b))) return false; // ima nadolazeći termin
  const hasPast = blocks.some(blockIsPast);
  const deadlinePast = t.deadline && t.deadline < todayStr();
  return hasPast || deadlinePast;
};
const fixedSegmentsForDay = (act, weekday) => {
  if (!act.days.includes(weekday)) return [];
  if (act.start < act.end) return [{
    start: act.start,
    end: act.end
  }];
  return [{
    start: act.start,
    end: 1440
  }, {
    start: 0,
    end: act.end
  }];
};
const getFixedBlocks = (fixed, weekday) => {
  const arr = [];
  fixed.forEach(f => fixedSegmentsForDay(f, weekday).forEach((seg, i) => arr.push({
    ...seg,
    title: f.title,
    color: f.color,
    kind: "fixed",
    id: f.id + "_" + i
  })));
  return arr;
};
const getTaskBlocks = (tasks, date) => {
  const arr = [];
  tasks.forEach(t => (t.blocks || []).forEach(b => {
    if (b.date === date) arr.push({
      start: b.start,
      end: b.start + b.duration,
      title: t.title,
      color: PRIORITIES[t.priority].color,
      area: t.area,
      done: t.done,
      kind: "task",
      taskId: t.id,
      id: b.id
    });
  }));
  return arr;
};
const freeMinutes = blocks => {
  const ivs = blocks.map(b => [Math.max(b.start, WAKE), Math.min(b.end, BED)]).filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  let busy = 0,
    curEnd = -1;
  ivs.forEach(([s, e]) => {
    if (s > curEnd) {
      busy += e - s;
      curEnd = e;
    } else if (e > curEnd) {
      busy += e - curEnd;
      curEnd = e;
    }
  });
  return Math.max(0, BED - WAKE - busy);
};
function layoutColumns(items) {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  let cluster = [],
    clusterEnd = -1;
  const out = [];
  const flush = () => {
    const cols = [];
    cluster.forEach(ev => {
      let placed = false;
      for (let c = 0; c < cols.length; c++) {
        if (cols[c][cols[c].length - 1].end <= ev.start) {
          cols[c].push(ev);
          ev._col = c;
          placed = true;
          break;
        }
      }
      if (!placed) {
        ev._col = cols.length;
        cols.push([ev]);
      }
    });
    cluster.forEach(ev => ev._cols = cols.length);
    out.push(...cluster);
  };
  sorted.forEach(ev => {
    if (cluster.length && ev.start >= clusterEnd) {
      flush();
      cluster = [];
      clusterEnd = -1;
    }
    cluster.push(ev);
    clusterEnd = Math.max(clusterEnd, ev.end);
  });
  if (cluster.length) flush();
  return out;
}
const DEFAULT_FIXED = [{
  id: uid(),
  title: "Spavanje",
  start: 23 * 60,
  end: 7 * 60,
  days: [0, 1, 2, 3, 4, 5, 6],
  color: "#475569"
}, {
  id: uid(),
  title: "Posao",
  start: 9 * 60,
  end: 16 * 60 + 30,
  days: [1, 2, 3, 4, 5],
  color: "#4f46e5"
}, {
  id: uid(),
  title: "Trening",
  start: 18 * 60,
  end: 19 * 60 + 30,
  days: [2, 4],
  color: "#16a34a"
}];

// ----------------------------- Storage (localStorage) -----------------------------
function usePersistentState(key, initial) {
  const [val, setVal] = useState(() => {
    try {
      const r = localStorage.getItem(key);
      return r != null ? JSON.parse(r) : initial;
    } catch (err) {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (err) {}
  }, [key, val]);
  return [val, setVal];
}

// ----------------------------- App -----------------------------
function App() {
  const [tab, setTab] = useState("dan");
  const [calMode, setCalMode] = useState("dan"); // dan | tjedan
  const [day, setDay] = useState(todayStr());
  const [tasks, setTasks] = usePersistentState("planer:v3:tasks", []);
  const [fixed, setFixed] = usePersistentState("planer:v3:fixed", DEFAULT_FIXED);
  const [workTasks, setWorkTasks] = usePersistentState("planer:v3:worktasks", []);
  const [detailId, setDetailId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [fixedEdit, setFixedEdit] = useState(null);
  const detailTask = tasks.find(t => t.id === detailId) || null;
  const updateTask = (id, patch) => setTasks(ts => ts.map(t => t.id === id ? {
    ...t,
    ...patch
  } : t));
  const deleteTask = id => {
    setTasks(ts => ts.filter(t => t.id !== id));
    setDetailId(null);
  };
  const quickReschedule = (id, date) => {
    const t = tasks.find(x => x.id === id);
    if (!t) return;
    const dur = t.estimate && t.estimate <= 240 ? t.estimate : 60;
    updateTask(id, {
      blocks: [...(t.blocks || []), {
        id: uid(),
        date,
        start: QUICK_START,
        duration: dur
      }]
    });
  };
  const slipped = useMemo(() => tasks.filter(isSlipped), [tasks]);
  const goToDay = d => {
    setDay(d);
    setCalMode("dan");
    setTab("dan");
  };
  return /*#__PURE__*/React.createElement("div", {
    style: S.app
  }, /*#__PURE__*/React.createElement("style", null, CSS), /*#__PURE__*/React.createElement("header", {
    style: S.header
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 800,
      fontSize: 18,
      letterSpacing: -0.3
    }
  }, "Planer"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "#64748b"
    }
  }, tab === "dan" ? calMode === "dan" ? longDate(day) : "Tjedan" : tab === "backlog" ? "Backlog" : "Postavke")), /*#__PURE__*/React.createElement("main", {
    style: S.main
  }, tab === "dan" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: S.segWrap
  }, /*#__PURE__*/React.createElement("button", {
    style: {
      ...S.seg,
      ...(calMode === "dan" ? S.segOn : {})
    },
    onClick: () => setCalMode("dan")
  }, "Dan"), /*#__PURE__*/React.createElement("button", {
    style: {
      ...S.seg,
      ...(calMode === "tjedan" ? S.segOn : {})
    },
    onClick: () => setCalMode("tjedan")
  }, "Tjedan")), calMode === "dan" ? /*#__PURE__*/React.createElement(DayView, {
    day: day,
    setDay: setDay,
    fixed: fixed,
    tasks: tasks,
    workTasks: workTasks,
    setWorkTasks: setWorkTasks,
    onOpenTask: setDetailId,
    slipped: slipped,
    onQuickResched: quickReschedule,
    onComplete: id => updateTask(id, {
      done: true
    })
  }) : /*#__PURE__*/React.createElement(WeekView, {
    day: day,
    setDay: setDay,
    fixed: fixed,
    tasks: tasks,
    onOpenTask: setDetailId,
    onJumpDay: goToDay
  })), tab === "backlog" && /*#__PURE__*/React.createElement(BacklogView, {
    tasks: tasks,
    onOpenTask: setDetailId,
    onAdd: () => setShowAdd(true)
  }), tab === "postavke" && /*#__PURE__*/React.createElement(SettingsView, {
    fixed: fixed,
    setFixed: setFixed,
    tasks: tasks,
    setTasks: setTasks,
    workTasks: workTasks,
    setWorkTasks: setWorkTasks,
    onEdit: setFixedEdit
  })), /*#__PURE__*/React.createElement("nav", {
    style: S.nav
  }, /*#__PURE__*/React.createElement(NavBtn, {
    active: tab === "dan",
    onClick: () => setTab("dan"),
    icon: "\uD83D\uDCC5",
    label: "Kalendar"
  }), /*#__PURE__*/React.createElement(NavBtn, {
    active: tab === "backlog",
    onClick: () => setTab("backlog"),
    icon: "\uD83D\uDCE5",
    label: "Backlog",
    badge: slipped.length || null
  }), /*#__PURE__*/React.createElement(NavBtn, {
    active: tab === "postavke",
    onClick: () => setTab("postavke"),
    icon: "\u2699\uFE0F",
    label: "Postavke"
  })), showAdd && /*#__PURE__*/React.createElement(AddTaskModal, {
    onClose: () => setShowAdd(false),
    onCreate: t => {
      setTasks(ts => [...ts, t]);
      setShowAdd(false);
      setDetailId(t.id);
    }
  }), detailTask && /*#__PURE__*/React.createElement(TaskDetail, {
    task: detailTask,
    defaultDay: day,
    onClose: () => setDetailId(null),
    onChange: patch => updateTask(detailTask.id, patch),
    onDelete: () => deleteTask(detailTask.id),
    onJump: goToDay
  }), fixedEdit && /*#__PURE__*/React.createElement(FixedModal, {
    init: fixedEdit === "new" ? null : fixedEdit,
    onClose: () => setFixedEdit(null),
    onSave: a => {
      setFixed(fs => fixedEdit === "new" ? [...fs, a] : fs.map(f => f.id === a.id ? a : f));
      setFixedEdit(null);
    },
    onDelete: fixedEdit !== "new" ? () => {
      setFixed(fs => fs.filter(f => f.id !== fixedEdit.id));
      setFixedEdit(null);
    } : null
  }));
}

// ----------------------------- Dan -----------------------------
function DayView({
  day,
  setDay,
  fixed,
  tasks,
  workTasks,
  setWorkTasks,
  onOpenTask,
  slipped,
  onQuickResched,
  onComplete
}) {
  const weekday = parseDate(day).getDay();
  const scrollRef = useRef(null);
  const fixedBlocks = useMemo(() => getFixedBlocks(fixed, weekday), [fixed, weekday]);
  const taskBlocks = useMemo(() => getTaskBlocks(tasks, day), [tasks, day]);
  const laidFixed = useMemo(() => layoutColumns(fixedBlocks.map(b => ({
    ...b
  }))), [fixedBlocks]);
  const laidTask = useMemo(() => layoutColumns(taskBlocks.map(b => ({
    ...b
  }))), [taskBlocks]);
  const free = useMemo(() => freeMinutes([...fixedBlocks, ...taskBlocks]), [fixedBlocks, taskBlocks]);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = (8 - START_HOUR) * HOUR_HEIGHT;
  }, []);
  const isToday = day === todayStr();
  const now = new Date();
  const nowY = (now.getHours() * 60 + now.getMinutes() - DAY_START_MIN) / 60 * HOUR_HEIGHT;
  const dayWork = workTasks.filter(w => w.date === day);
  const todaysTaskList = taskBlocks.slice().sort((a, b) => a.start - b.start);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: S.dayNav
  }, /*#__PURE__*/React.createElement("button", {
    style: S.navArrow,
    onClick: () => setDay(addDays(day, -1))
  }, "\u2039"), /*#__PURE__*/React.createElement("button", {
    style: S.todayBtn,
    onClick: () => setDay(todayStr())
  }, isToday ? "Danas" : "Skoči na danas"), /*#__PURE__*/React.createElement("button", {
    style: S.navArrow,
    onClick: () => setDay(addDays(day, 1))
  }, "\u203A")), slipped.length > 0 && /*#__PURE__*/React.createElement(SlippedCard, {
    slipped: slipped,
    onOpenTask: onOpenTask,
    onQuickResched: onQuickResched
  }), /*#__PURE__*/React.createElement("div", {
    style: S.freeBar
  }, /*#__PURE__*/React.createElement("span", null, "Slobodno u danu"), /*#__PURE__*/React.createElement("strong", {
    style: {
      color: free < 60 ? "#dc2626" : "#16a34a"
    }
  }, "~", Math.floor(free / 60), "h ", free % 60, "min")), /*#__PURE__*/React.createElement("div", {
    ref: scrollRef,
    style: S.calScroll
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      height: TOTAL_HEIGHT,
      marginLeft: 46
    }
  }, Array.from({
    length: END_HOUR - START_HOUR + 1
  }).map((_, i) => {
    const h = START_HOUR + i;
    return /*#__PURE__*/React.createElement("div", {
      key: h,
      style: {
        ...S.hourRow,
        top: i * HOUR_HEIGHT
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: S.hourLabel
    }, String(h).padStart(2, "0"), ":00"), /*#__PURE__*/React.createElement("div", {
      style: S.hourLine
    }));
  }), laidFixed.map(b => /*#__PURE__*/React.createElement(Block, {
    key: b.id,
    b: b,
    faded: true
  })), laidTask.map(b => /*#__PURE__*/React.createElement(Block, {
    key: b.id,
    b: b,
    onClick: () => onOpenTask(b.taskId)
  })), isToday && nowY > 0 && nowY < TOTAL_HEIGHT && /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.nowLine,
      top: nowY
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: S.nowDot
  })))), todaysTaskList.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: S.workCard
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 15
    }
  }, "\uD83D\uDCC5"), /*#__PURE__*/React.createElement("strong", {
    style: {
      fontSize: 14
    }
  }, "Zakazano danas")), todaysTaskList.map(b => /*#__PURE__*/React.createElement("div", {
    key: b.id,
    style: S.workRow
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => onComplete(b.taskId),
    style: {
      ...S.check,
      ...(b.done ? S.checkOn : {})
    }
  }, b.done ? "✓" : ""), /*#__PURE__*/React.createElement("button", {
    onClick: () => onOpenTask(b.taskId),
    style: {
      flex: 1,
      textAlign: "left",
      border: "none",
      background: "none",
      cursor: "pointer",
      fontSize: 13.5,
      textDecoration: b.done ? "line-through" : "none",
      color: b.done ? "#94a3b8" : "#1e293b"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "#94a3b8",
      fontWeight: 600,
      marginRight: 6
    }
  }, min2hhmm(b.start)), b.title)))), /*#__PURE__*/React.createElement(WorkToday, {
    day: day,
    items: dayWork,
    setWorkTasks: setWorkTasks
  }));
}
function SlippedCard({
  slipped,
  onOpenTask,
  onQuickResched
}) {
  const [open, setOpen] = useState(true);
  return /*#__PURE__*/React.createElement("div", {
    style: S.slipCard
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setOpen(!open),
    style: S.slipHead
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14
    }
  }, "\u26A0\uFE0F"), /*#__PURE__*/React.createElement("strong", {
    style: {
      fontSize: 13.5,
      color: "#b45309"
    }
  }, "Zaostalo \u2014 ", slipped.length, " ", slipped.length === 1 ? "task" : "taskova"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      color: "#b45309"
    }
  }, open ? "▾" : "▸")), open && slipped.map(t => /*#__PURE__*/React.createElement("div", {
    key: t.id,
    style: S.slipRow
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => onOpenTask(t.id),
    style: {
      flex: 1,
      textAlign: "left",
      border: "none",
      background: "none",
      cursor: "pointer",
      fontSize: 13.5,
      color: "#1e293b",
      padding: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: PRIORITIES[t.priority].color,
      marginRight: 5
    }
  }, "\u25CF"), t.title), /*#__PURE__*/React.createElement("button", {
    onClick: () => onQuickResched(t.id, todayStr()),
    style: S.chip
  }, "Danas"), /*#__PURE__*/React.createElement("button", {
    onClick: () => onQuickResched(t.id, addDays(todayStr(), 1)),
    style: S.chip
  }, "Sutra"))));
}
function Block({
  b,
  faded,
  onClick
}) {
  const top = (b.start - DAY_START_MIN) / 60 * HOUR_HEIGHT;
  const height = Math.max((b.end - b.start) / 60 * HOUR_HEIGHT - 2, 16);
  const cols = b._cols || 1,
    col = b._col || 0,
    w = 100 / cols;
  if (top + height < 0 || top > TOTAL_HEIGHT) return null;
  const renderedTop = Math.max(top, 0);
  const renderedHeight = top < 0 ? Math.max(height + top, 16) : height;
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    style: {
      position: "absolute",
      top: renderedTop,
      height: renderedHeight,
      left: `calc(${col * w}% + 2px)`,
      width: `calc(${w}% - 4px)`,
      background: faded ? `${b.color}14` : b.color,
      borderLeft: `3px solid ${b.color}`,
      color: faded ? "#334155" : "#fff",
      borderRadius: 7,
      padding: "3px 7px",
      overflow: "hidden",
      cursor: onClick ? "pointer" : "default",
      opacity: b.done ? 0.55 : 1,
      boxShadow: faded ? "none" : "0 1px 3px rgba(0,0,0,.15)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 700,
      lineHeight: 1.15,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      textDecoration: b.done ? "line-through" : "none"
    }
  }, b.done ? "✓ " : "", b.title), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10.5,
      opacity: 0.85
    }
  }, min2hhmm(b.start), "\u2013", min2hhmm(b.end), b.area ? ` · ${b.area}` : ""));
}
function WorkToday({
  day,
  items,
  setWorkTasks
}) {
  const [txt, setTxt] = useState(""); return null;
  const add = () => {
    const v = txt.trim();
    if (!v) return;
    setWorkTasks(ws => [...ws, {
      id: uid(),
      date: day,
      text: v,
      done: false
    }]);
    setTxt("");
  };
  return /*#__PURE__*/React.createElement("div", {
    style: S.workCard
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 15
    }
  }, "\uD83D\uDCBC"), /*#__PURE__*/React.createElement("strong", {
    style: {
      fontSize: 14
    }
  }, "Posao danas"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      fontSize: 12,
      color: "#94a3b8"
    }
  }, items.filter(i => i.done).length, "/", items.length)), items.map(it => /*#__PURE__*/React.createElement("div", {
    key: it.id,
    style: S.workRow
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setWorkTasks(ws => ws.map(w => w.id === it.id ? {
      ...w,
      done: !w.done
    } : w)),
    style: {
      ...S.check,
      ...(it.done ? S.checkOn : {})
    }
  }, it.done ? "✓" : ""), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 13.5,
      textDecoration: it.done ? "line-through" : "none",
      color: it.done ? "#94a3b8" : "#1e293b"
    }
  }, it.text), /*#__PURE__*/React.createElement("button", {
    onClick: () => setWorkTasks(ws => ws.filter(w => w.id !== it.id)),
    style: S.xBtn
  }, "\xD7"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      marginTop: 6
    }
  }, /*#__PURE__*/React.createElement("input", {
    value: txt,
    onChange: e => setTxt(e.target.value),
    onKeyDown: e => e.key === "Enter" && add(),
    placeholder: "Dodaj radni zadatak\u2026",
    style: S.input
  }), /*#__PURE__*/React.createElement("button", {
    onClick: add,
    style: S.addMini
  }, "+")));
}

// ----------------------------- Tjedan -----------------------------
function WeekView({
  day,
  setDay,
  fixed,
  tasks,
  onOpenTask,
  onJumpDay
}) {
  const monday = mondayOf(day);
  const days = Array.from({
    length: 7
  }).map((_, i) => addDays(monday, i));
  const today = todayStr();
  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = (8 - START_HOUR) * HOUR_HEIGHT;
  }, []);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: S.dayNav
  }, /*#__PURE__*/React.createElement("button", {
    style: S.navArrow,
    onClick: () => setDay(addDays(monday, -7))
  }, "\u2039"), /*#__PURE__*/React.createElement("button", {
    style: S.todayBtn,
    onClick: () => setDay(today)
  }, "Ovaj tjedan"), /*#__PURE__*/React.createElement("button", {
    style: S.navArrow,
    onClick: () => setDay(addDays(monday, 7))
  }, "\u203A")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      marginBottom: 4
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 26
    }
  }), days.map((d, i) => {
    const isT = d === today;
    const free = freeMinutes([...getFixedBlocks(fixed, parseDate(d).getDay()), ...getTaskBlocks(tasks, d)]);
    return /*#__PURE__*/React.createElement("button", {
      key: d,
      onClick: () => onJumpDay(d),
      style: {
        flex: 1,
        border: "none",
        background: isT ? "#eef2ff" : "none",
        borderRadius: 8,
        padding: "4px 0",
        cursor: "pointer"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: isT ? "#4f46e5" : "#94a3b8"
      }
    }, WD_SHORT[i]), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        fontWeight: 800,
        color: isT ? "#4f46e5" : "#1e293b"
      }
    }, parseDate(d).getDate()), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 8.5,
        color: free < 60 ? "#dc2626" : "#94a3b8"
      }
    }, Math.floor(free / 60), "h"));
  })), /*#__PURE__*/React.createElement("div", {
    ref: scrollRef,
    style: {
      ...S.calScroll,
      maxHeight: "62vh"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      height: TOTAL_HEIGHT,
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 26,
      position: "relative",
      flexShrink: 0
    }
  }, Array.from({
    length: (END_HOUR - START_HOUR) / 2 + 1
  }).map((_, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      position: "absolute",
      top: i * 2 * HOUR_HEIGHT - 5,
      right: 2,
      fontSize: 9,
      color: "#cbd5e1",
      fontWeight: 600
    }
  }, String(START_HOUR + i * 2).padStart(2, "0")))), days.map(d => {
    const wd = parseDate(d).getDay();
    const fb = layoutColumns(getFixedBlocks(fixed, wd).map(b => ({
      ...b
    })));
    const tb = layoutColumns(getTaskBlocks(tasks, d).map(b => ({
      ...b
    })));
    return /*#__PURE__*/React.createElement("div", {
      key: d,
      style: {
        flex: 1,
        position: "relative",
        borderLeft: "1px solid #f1f5f9",
        height: TOTAL_HEIGHT
      }
    }, Array.from({
      length: (END_HOUR - START_HOUR) / 2
    }).map((_, i) => /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        position: "absolute",
        left: 0,
        right: 0,
        top: (i * 2 + 2) * HOUR_HEIGHT - HOUR_HEIGHT,
        borderTop: "1px solid #f8fafc"
      }
    })), fb.map(b => /*#__PURE__*/React.createElement(MiniBlock, {
      key: b.id,
      b: b,
      faded: true
    })), tb.map(b => /*#__PURE__*/React.createElement(MiniBlock, {
      key: b.id,
      b: b,
      onClick: () => onOpenTask(b.taskId)
    })));
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: "#94a3b8",
      textAlign: "center",
      marginTop: 8
    }
  }, "Tapni dan gore za detaljan prikaz \xB7 broj = slobodni sati"));
}
function MiniBlock({
  b,
  faded,
  onClick
}) {
  const top = (b.start - DAY_START_MIN) / 60 * HOUR_HEIGHT;
  const height = Math.max((b.end - b.start) / 60 * HOUR_HEIGHT - 1, 8);
  if (top + height < 0 || top > TOTAL_HEIGHT) return null;
  const renderedTop = Math.max(top, 0);
  const renderedHeight = top < 0 ? Math.max(height + top, 8) : height;
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClick,
    style: {
      position: "absolute",
      top: renderedTop,
      height: renderedHeight,
      left: 1,
      right: 1,
      background: faded ? `${b.color}20` : b.color,
      borderRadius: 3,
      cursor: onClick ? "pointer" : "default",
      opacity: b.done ? 0.5 : 1,
      overflow: "hidden"
    }
  }, height > 22 && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 8,
      fontWeight: 700,
      color: faded ? "#475569" : "#fff",
      padding: "1px 2px",
      lineHeight: 1.1,
      overflow: "hidden"
    }
  }, b.title));
}

// ----------------------------- Backlog -----------------------------
function BacklogView({
  tasks,
  onOpenTask,
  onAdd
}) {
  const [filter, setFilter] = useState("nezakazani");
  const groups = useMemo(() => {
    let l = [...tasks];
    if (filter === "nezakazani") l = l.filter(t => !t.done && !(t.blocks && t.blocks.length));else if (filter === "zaostali") l = l.filter(isSlipped);else if (filter === "gotovi") l = l.filter(t => t.done);
    const sortFn = (a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (a.deadline && b.deadline) return a.deadline < b.deadline ? -1 : 1;
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return 0;
    };
    const areaOrder = Object.keys(AREAS);
    const grouped = {};
    l.forEach(t => { const a = t.area || "Ostalo"; if (!grouped[a]) grouped[a] = []; grouped[a].push(t); });
    areaOrder.forEach(a => { if (grouped[a]) grouped[a].sort(sortFn); });
    return areaOrder.filter(a => grouped[a] && grouped[a].length > 0).map(a => ({ area: a, tasks: grouped[a] }));
  }, [tasks, filter]);
  const counts = useMemo(() => ({
    nezakazani: tasks.filter(t => !t.done && !(t.blocks && t.blocks.length)).length,
    zaostali: tasks.filter(isSlipped).length,
    gotovi: tasks.filter(t => t.done).length
  }), [tasks]);
  const filters = [["nezakazani", "Nezakazani"], ["zaostali", "Zaostali"], ["gotovi", "Gotovi"], ["svi", "Svi"]];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.segWrap,
      marginBottom: 12
    }
  }, filters.map(([k, lab]) => /*#__PURE__*/React.createElement("button", {
    key: k,
    style: {
      ...S.seg,
      fontSize: 12.5,
      ...(filter === k ? S.segOn : {})
    },
    onClick: () => setFilter(k)
  }, lab, counts[k] ? ` ${counts[k]}` : ""))), groups.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: S.empty
  }, "Nema taskova ovdje."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 4
    }
  }, groups.map(g => /*#__PURE__*/React.createElement(React.Fragment, {key: g.area}, /*#__PURE__*/React.createElement("div", {style: {fontSize: 11, fontWeight: 700, color: AREAS[g.area], textTransform: "uppercase", letterSpacing: 0.5, marginTop: 10, marginBottom: 2, paddingLeft: 2}}, g.area), g.tasks.map(t => /*#__PURE__*/React.createElement(TaskCard, {key: t.id, t: t, onClick: () => onOpenTask(t.id)}))))), /*#__PURE__*/React.createElement("button", {
    onClick: onAdd,
    style: S.fab
  }, "\uFF0B Novi task"));
}
function TaskCard({
  t,
  onClick
}) {
  const p = PRIORITIES[t.priority];
  const done = (t.checklist || []).filter(c => c.done).length,
    total = (t.checklist || []).length;
  const scheduled = (t.blocks || []).length;
  const overdue = t.deadline && t.deadline < todayStr() && !t.done;
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    style: {
      ...S.taskCard,
      borderLeft: `4px solid ${p.color}`,
      opacity: t.done ? 0.6 : 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 14.5,
      fontWeight: 600,
      textAlign: "left",
      textDecoration: t.done ? "line-through" : "none"
    }
  }, t.done ? "✓ " : "", t.title), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      fontWeight: 700,
      color: p.color,
      background: p.soft,
      padding: "2px 7px",
      borderRadius: 6
    }
  }, p.label)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      marginTop: 6,
      flexWrap: "wrap",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      fontWeight: 600,
      color: AREAS[t.area],
      background: `${AREAS[t.area]}14`,
      padding: "2px 7px",
      borderRadius: 6
    }
  }, t.area), t.estimate ? /*#__PURE__*/React.createElement(Tag, null, "\u2248 ", Math.round(t.estimate / 60 * 10) / 10, "h") : null, total > 0 && /*#__PURE__*/React.createElement(Tag, null, "\u2611 ", done, "/", total), scheduled > 0 && /*#__PURE__*/React.createElement(Tag, null, "\uD83D\uDCC5 ", scheduled), t.deadline && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      fontWeight: 600,
      marginLeft: "auto",
      color: overdue ? "#dc2626" : "#64748b"
    }
  }, "\u23F0 ", longDate(t.deadline))));
}
const Tag = ({
  children
}) => /*#__PURE__*/React.createElement("span", {
  style: {
    fontSize: 11,
    fontWeight: 600,
    color: "#64748b",
    background: "#f1f5f9",
    padding: "2px 7px",
    borderRadius: 6
  }
}, children);

// ----------------------------- Detalj -----------------------------
function TaskDetail({
  task,
  defaultDay,
  onClose,
  onChange,
  onDelete,
  onJump
}) {
  const [clTxt, setClTxt] = useState("");
  const [adding, setAdding] = useState(false);
  const addStep = () => {
    const v = clTxt.trim();
    if (!v) return;
    onChange({
      checklist: [...(task.checklist || []), {
        id: uid(),
        text: v,
        done: false
      }]
    });
    setClTxt("");
  };
  const toggleStep = id => onChange({
    checklist: task.checklist.map(c => c.id === id ? {
      ...c,
      done: !c.done
    } : c)
  });
  const delStep = id => onChange({
    checklist: task.checklist.filter(c => c.id !== id)
  });
  const addBlock = b => onChange({
    blocks: [...(task.blocks || []), b]
  });
  const delBlock = id => onChange({
    blocks: task.blocks.filter(b => b.id !== id)
  });
  const total = (task.checklist || []).length,
    done = (task.checklist || []).filter(c => c.done).length;
  return /*#__PURE__*/React.createElement(Modal, {
    onClose: onClose
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("input", {
    value: task.title,
    onChange: e => onChange({
      title: e.target.value
    }),
    style: {
      ...S.input,
      fontSize: 17,
      fontWeight: 700,
      border: "none",
      padding: 0,
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    style: S.xBtn
  }, "\xD7")), /*#__PURE__*/React.createElement("button", {
    onClick: () => onChange({
      done: !task.done
    }),
    style: {
      ...S.doneToggle,
      ...(task.done ? S.doneOn : {})
    }
  }, task.done ? "✓ Završeno — vrati u rad" : "Označi završenim"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Prioritet"), /*#__PURE__*/React.createElement("select", {
    value: task.priority,
    onChange: e => onChange({
      priority: Number(e.target.value)
    }),
    style: S.select
  }, Object.entries(PRIORITIES).map(([k, v]) => /*#__PURE__*/React.createElement("option", {
    key: k,
    value: k
  }, v.dot, " ", v.label)))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Podru\u010Dje"), /*#__PURE__*/React.createElement("select", {
    value: task.area,
    onChange: e => onChange({
      area: e.target.value
    }),
    style: S.select
  }, Object.keys(AREAS).map(a => /*#__PURE__*/React.createElement("option", {
    key: a
  }, a))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Rok"), /*#__PURE__*/React.createElement("input", {
    type: "date",
    value: task.deadline || "",
    onChange: e => onChange({
      deadline: e.target.value || null
    }),
    style: S.select
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Procjena (h)"), /*#__PURE__*/React.createElement("input", {
    type: "number",
    min: "0",
    step: "0.5",
    value: task.estimate ? task.estimate / 60 : "",
    placeholder: "npr. 4",
    onChange: e => onChange({
      estimate: e.target.value ? Math.round(Number(e.target.value) * 60) : null
    }),
    style: S.select
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Koraci ", total > 0 ? `(${done}/${total})` : ""), total > 0 && /*#__PURE__*/React.createElement("div", {
    style: S.progressOuter
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      ...S.progressInner,
      width: `${done / total * 100}%`
    }
  })), (task.checklist || []).map(c => /*#__PURE__*/React.createElement("div", {
    key: c.id,
    style: S.workRow
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => toggleStep(c.id),
    style: {
      ...S.check,
      ...(c.done ? S.checkOn : {})
    }
  }, c.done ? "✓" : ""), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 13.5,
      textDecoration: c.done ? "line-through" : "none",
      color: c.done ? "#94a3b8" : "#1e293b"
    }
  }, c.text), /*#__PURE__*/React.createElement("button", {
    onClick: () => delStep(c.id),
    style: S.xBtn
  }, "\xD7"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      marginTop: 6
    }
  }, /*#__PURE__*/React.createElement("input", {
    value: clTxt,
    onChange: e => setClTxt(e.target.value),
    onKeyDown: e => e.key === "Enter" && addStep(),
    placeholder: "Dodaj korak\u2026",
    style: S.input
  }), /*#__PURE__*/React.createElement("button", {
    onClick: addStep,
    style: S.addMini
  }, "+"))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Termini u kalendaru"), (task.blocks || []).length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "#94a3b8",
      marginBottom: 6
    }
  }, "Jo\u0161 nije zakazano."), (task.blocks || []).slice().sort((a, b) => (a.date + min2hhmm(a.start)).localeCompare(b.date + min2hhmm(b.start))).map(b => {
    const past = blockIsPast(b);
    return /*#__PURE__*/React.createElement("div", {
      key: b.id,
      style: S.blockRow
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => onJump(b.date),
      style: {
        flex: 1,
        textAlign: "left",
        background: "none",
        border: "none",
        fontSize: 13.5,
        cursor: "pointer",
        color: past ? "#94a3b8" : "#1e293b"
      }
    }, "\uD83D\uDCC5 ", longDate(b.date), " \xB7 ", min2hhmm(b.start), "\u2013", min2hhmm(b.start + b.duration), past ? " · prošlo" : ""), /*#__PURE__*/React.createElement("button", {
      onClick: () => delBlock(b.id),
      style: S.xBtn
    }, "\xD7"));
  }), adding ? /*#__PURE__*/React.createElement(ScheduleForm, {
    defaultDay: defaultDay,
    onCancel: () => setAdding(false),
    onAdd: b => {
      addBlock(b);
      setAdding(false);
    }
  }) : /*#__PURE__*/React.createElement("button", {
    onClick: () => setAdding(true),
    style: S.addTermin
  }, "\uFF0B Dodaj termin")), /*#__PURE__*/React.createElement("button", {
    onClick: onDelete,
    style: S.deleteBtn
  }, "Obri\u0161i task"));
}
function ScheduleForm({
  defaultDay,
  onCancel,
  onAdd
}) {
  const [date, setDate] = useState(defaultDay);
  const [start, setStart] = useState(9 * 60);
  const [dur, setDur] = useState(60);
  const times = [];
  for (let m = DAY_START_MIN; m <= DAY_END_MIN - 15; m += 15) times.push(m);
  const durs = [15, 30, 45, 60, 90, 120, 180, 240];
  return /*#__PURE__*/React.createElement("div", {
    style: S.schedBox
  }, /*#__PURE__*/React.createElement(Label, null, "Datum"), /*#__PURE__*/React.createElement("input", {
    type: "date",
    value: date,
    onChange: e => setDate(e.target.value),
    style: {
      ...S.select,
      marginBottom: 8
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Po\u010Detak"), /*#__PURE__*/React.createElement("select", {
    value: start,
    onChange: e => setStart(Number(e.target.value)),
    style: S.select
  }, times.map(m => /*#__PURE__*/React.createElement("option", {
    key: m,
    value: m
  }, min2hhmm(m))))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Trajanje"), /*#__PURE__*/React.createElement("select", {
    value: dur,
    onChange: e => setDur(Number(e.target.value)),
    style: S.select
  }, durs.map(d => /*#__PURE__*/React.createElement("option", {
    key: d,
    value: d
  }, d < 60 ? `${d} min` : `${d / 60} h`))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onCancel,
    style: S.ghostBtn
  }, "Odustani"), /*#__PURE__*/React.createElement("button", {
    onClick: () => onAdd({
      id: uid(),
      date,
      start,
      duration: dur
    }),
    style: S.primaryBtn
  }, "Zaka\u017Ei")));
}

// ----------------------------- Novi task -----------------------------
function AddTaskModal({
  onClose,
  onCreate
}) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState(3);
  const [area, setArea] = useState("Posao");
  const [deadline, setDeadline] = useState("");
  const create = () => {
    const v = title.trim();
    if (!v) return;
    onCreate({
      id: uid(),
      title: v,
      priority,
      area,
      deadline: deadline || null,
      estimate: null,
      checklist: [],
      blocks: [],
      done: false
    });
  };
  return /*#__PURE__*/React.createElement(Modal, {
    onClose: onClose
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("strong", {
    style: {
      fontSize: 17
    }
  }, "Novi task"), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    style: S.xBtn
  }, "\xD7")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement(Label, null, "\u0160to treba napraviti?"), /*#__PURE__*/React.createElement("input", {
    autoFocus: true,
    value: title,
    onChange: e => setTitle(e.target.value),
    onKeyDown: e => e.key === "Enter" && create(),
    placeholder: "npr. Papiri za legalizaciju Podstrana",
    style: S.input
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Prioritet"), /*#__PURE__*/React.createElement("select", {
    value: priority,
    onChange: e => setPriority(Number(e.target.value)),
    style: S.select
  }, Object.entries(PRIORITIES).map(([k, v]) => /*#__PURE__*/React.createElement("option", {
    key: k,
    value: k
  }, v.dot, " ", v.label)))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Podru\u010Dje"), /*#__PURE__*/React.createElement("select", {
    value: area,
    onChange: e => setArea(e.target.value),
    style: S.select
  }, Object.keys(AREAS).map(a => /*#__PURE__*/React.createElement("option", {
    key: a
  }, a))))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Rok (nije obavezno)"), /*#__PURE__*/React.createElement("input", {
    type: "date",
    value: deadline,
    onChange: e => setDeadline(e.target.value),
    style: S.select
  })), /*#__PURE__*/React.createElement("button", {
    onClick: create,
    style: {
      ...S.primaryBtn,
      width: "100%",
      marginTop: 16
    }
  }, "Spremi task"));
}

// ----------------------------- Postavke -----------------------------
function SettingsView({
  fixed,
  setFixed,
  tasks,
  setTasks,
  workTasks,
  setWorkTasks,
  onEdit
}) {
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 800,
      color: "#475569",
      marginBottom: 8
    }
  }, "Fiksne aktivnosti"), /*#__PURE__*/React.createElement("div", {
    style: S.empty2
  }, "Ponavljaju se svaki tjedan. Sive su u kalendaru i oduzimaju slobodno vrijeme."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8,
      marginBottom: 8
    }
  }, fixed.map(f => /*#__PURE__*/React.createElement("button", {
    key: f.id,
    onClick: () => onEdit(f),
    style: {
      ...S.taskCard,
      borderLeft: `4px solid ${f.color}`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 14.5,
      fontWeight: 600,
      textAlign: "left"
    }
  }, f.title), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "#64748b"
    }
  }, min2hhmm(f.start), "\u2013", min2hhmm(f.end))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 4,
      marginTop: 8
    }
  }, WEEKDAYS.map((d, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      fontSize: 10.5,
      fontWeight: 700,
      width: 26,
      textAlign: "center",
      padding: "2px 0",
      borderRadius: 5,
      background: f.days.includes(i) ? `${f.color}22` : "#f1f5f9",
      color: f.days.includes(i) ? f.color : "#cbd5e1"
    }
  }, d)))))), /*#__PURE__*/React.createElement("button", {
    onClick: () => onEdit("new"),
    style: {
      ...S.addTermin,
      marginBottom: 24
    }
  }, "\uFF0B Nova aktivnost"), /*#__PURE__*/React.createElement(BackupSection, {
    fixed: fixed,
    setFixed: setFixed,
    tasks: tasks,
    setTasks: setTasks,
    workTasks: workTasks,
    setWorkTasks: setWorkTasks
  }));
}
function BackupSection({
  fixed,
  setFixed,
  tasks,
  setTasks,
  workTasks,
  setWorkTasks
}) {
  const [show, setShow] = useState(false);
  const [importTxt, setImportTxt] = useState("");
  const [msg, setMsg] = useState("");
  const json = useMemo(() => JSON.stringify({
    version: 3,
    tasks,
    fixed,
    workTasks
  }, null, 2), [tasks, fixed, workTasks]);
  const doImport = () => {
    try {
      const d = JSON.parse(importTxt);
      if (d.tasks) setTasks(d.tasks);
      if (d.fixed) setFixed(d.fixed);
      if (d.workTasks) setWorkTasks(d.workTasks);
      setMsg("✓ Uvezeno");
      setImportTxt("");
    } catch (e) {
      setMsg("✗ Neispravan JSON");
    }
    setTimeout(() => setMsg(""), 2500);
  };
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 800,
      color: "#475569",
      marginBottom: 8
    }
  }, "Sigurnosna kopija"), /*#__PURE__*/React.createElement("div", {
    style: S.empty2
  }, "Kopiraj tekst i spremi negdje (npr. u bilje\u0161ku). Za vra\u0107anje zalijepi natrag i klikni Uvezi."), /*#__PURE__*/React.createElement("button", {
    onClick: () => setShow(!show),
    style: {
      ...S.ghostBtn,
      width: "100%"
    }
  }, show ? "Sakrij" : "Prikaži podatke"), show && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Izvoz (kopiraj sve ispod)"), /*#__PURE__*/React.createElement("textarea", {
    readOnly: true,
    value: json,
    onFocus: e => e.target.select(),
    style: {
      ...S.input,
      height: 100,
      fontFamily: "monospace",
      fontSize: 11
    }
  }), /*#__PURE__*/React.createElement(Label, null, "Uvoz (zalijepi ovdje)"), /*#__PURE__*/React.createElement("textarea", {
    value: importTxt,
    onChange: e => setImportTxt(e.target.value),
    placeholder: "Zalijepi JSON\u2026",
    style: {
      ...S.input,
      height: 70,
      fontFamily: "monospace",
      fontSize: 11
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: doImport,
    style: {
      ...S.primaryBtn,
      width: "100%",
      marginTop: 8
    }
  }, "Uvezi (zamijeni sve)"), msg && /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      fontSize: 13,
      marginTop: 8,
      color: msg[0] === "✓" ? "#16a34a" : "#dc2626"
    }
  }, msg)));
}

// ----------------------------- Fiksna aktivnost modal -----------------------------
function FixedModal({
  init,
  onClose,
  onSave,
  onDelete
}) {
  const [title, setTitle] = useState(init?.title || "");
  const [start, setStart] = useState(init?.start ?? 9 * 60);
  const [end, setEnd] = useState(init?.end ?? 10 * 60);
  const [days, setDays] = useState(init?.days || [1, 2, 3, 4, 5]);
  const [color, setColor] = useState(init?.color || "#4f46e5");
  const times = [];
  for (let m = 0; m <= 1440; m += 15) times.push(m);
  const palette = ["#4f46e5", "#16a34a", "#ea580c", "#db2777", "#0891b2", "#475569", "#9333ea"];
  const toggleDay = i => setDays(d => d.includes(i) ? d.filter(x => x !== i) : [...d, i]);
  const save = () => {
    if (!title.trim()) return;
    onSave({
      id: init?.id || uid(),
      title: title.trim(),
      start,
      end,
      days: [...days].sort(),
      color
    });
  };
  return /*#__PURE__*/React.createElement(Modal, {
    onClose: onClose
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("strong", {
    style: {
      fontSize: 17
    }
  }, init ? "Uredi" : "Nova", " aktivnost"), /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    style: S.xBtn
  }, "\xD7")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Naziv"), /*#__PURE__*/React.createElement("input", {
    value: title,
    onChange: e => setTitle(e.target.value),
    placeholder: "npr. Trening",
    style: S.input
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Po\u010Detak"), /*#__PURE__*/React.createElement("select", {
    value: start,
    onChange: e => setStart(Number(e.target.value)),
    style: S.select
  }, times.map(m => /*#__PURE__*/React.createElement("option", {
    key: m,
    value: m
  }, min2hhmm(m))))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Kraj"), /*#__PURE__*/React.createElement("select", {
    value: end,
    onChange: e => setEnd(Number(e.target.value)),
    style: S.select
  }, times.map(m => /*#__PURE__*/React.createElement("option", {
    key: m,
    value: m
  }, min2hhmm(m)))))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Dani"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 4
    }
  }, WEEKDAYS.map((d, i) => /*#__PURE__*/React.createElement("button", {
    key: i,
    onClick: () => toggleDay(i),
    style: {
      flex: 1,
      padding: "8px 0",
      fontSize: 12,
      fontWeight: 700,
      borderRadius: 7,
      border: "none",
      cursor: "pointer",
      background: days.includes(i) ? color : "#f1f5f9",
      color: days.includes(i) ? "#fff" : "#94a3b8"
    }
  }, d)))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement(Label, null, "Boja"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, palette.map(c => /*#__PURE__*/React.createElement("button", {
    key: c,
    onClick: () => setColor(c),
    style: {
      width: 30,
      height: 30,
      borderRadius: "50%",
      background: c,
      border: color === c ? "3px solid #1e293b" : "3px solid transparent",
      cursor: "pointer"
    }
  })))), end < start && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "#ea580c",
      marginTop: 8
    }
  }, "Kraj prije po\u010Detka \u2192 prelazi pono\u0107 (npr. spavanje)."), /*#__PURE__*/React.createElement("button", {
    onClick: save,
    style: {
      ...S.primaryBtn,
      width: "100%",
      marginTop: 16
    }
  }, "Spremi"), onDelete && /*#__PURE__*/React.createElement("button", {
    onClick: onDelete,
    style: S.deleteBtn
  }, "Obri\u0161i aktivnost"));
}

// ----------------------------- Zajednički UI -----------------------------
function Modal({
  children,
  onClose
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: S.overlay,
    onClick: onClose
  }, /*#__PURE__*/React.createElement("div", {
    style: S.sheet,
    onClick: e => e.stopPropagation()
  }, children));
}
const Label = ({
  children
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    fontSize: 11.5,
    fontWeight: 700,
    color: "#94a3b8",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 4
  }
}, children);
function NavBtn({
  active,
  onClick,
  icon,
  label,
  badge
}) {
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    style: {
      ...S.navBtn,
      color: active ? "#4f46e5" : "#94a3b8"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 19,
      filter: active ? "none" : "grayscale(0.4)"
    }
  }, icon), badge && /*#__PURE__*/React.createElement("span", {
    style: S.badge
  }, badge)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10.5,
      fontWeight: 700
    }
  }, label));
}

// ----------------------------- Stilovi -----------------------------
const S = {
  app: {
    maxWidth: 480,
    margin: "0 auto",
    height: "100dvh",
    display: "flex",
    flexDirection: "column",
    background: "#f7f8fa",
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "#1e293b"
  },
  header: {
    padding: "14px 16px 10px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    background: "#fff",
    borderBottom: "1px solid #eef1f4"
  },
  main: {
    flex: 1,
    overflowY: "auto",
    padding: "12px 14px 90px"
  },
  nav: {
    display: "flex",
    borderTop: "1px solid #eef1f4",
    background: "#fff",
    paddingBottom: "env(safe-area-inset-bottom)"
  },
  navBtn: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
    padding: "9px 0",
    background: "none",
    border: "none",
    cursor: "pointer"
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -10,
    background: "#dc2626",
    color: "#fff",
    fontSize: 9.5,
    fontWeight: 800,
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 3px"
  },
  dayNav: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 10
  },
  navArrow: {
    width: 40,
    height: 40,
    borderRadius: 10,
    border: "1px solid #e2e8f0",
    background: "#fff",
    fontSize: 22,
    color: "#475569",
    cursor: "pointer",
    lineHeight: 1
  },
  todayBtn: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    border: "1px solid #e2e8f0",
    background: "#fff",
    fontSize: 14,
    fontWeight: 700,
    color: "#1e293b",
    cursor: "pointer"
  },
  freeBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 13,
    color: "#64748b",
    background: "#fff",
    border: "1px solid #eef1f4",
    borderRadius: 10,
    padding: "8px 12px",
    marginBottom: 10
  },
  slipCard: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    borderRadius: 12,
    padding: "4px 12px 10px",
    marginBottom: 10
  },
  slipHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    border: "none",
    background: "none",
    cursor: "pointer",
    padding: "8px 0"
  },
  slipRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 0"
  },
  chip: {
    border: "1px solid #fcd34d",
    background: "#fff",
    color: "#b45309",
    borderRadius: 7,
    padding: "4px 9px",
    fontSize: 11.5,
    fontWeight: 700,
    cursor: "pointer",
    flexShrink: 0
  },
  calScroll: {
    background: "#fff",
    border: "1px solid #eef1f4",
    borderRadius: 12,
    overflowY: "auto",
    maxHeight: "52vh",
    padding: "8px 8px 8px 0"
  },
  hourRow: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 0
  },
  hourLabel: {
    position: "absolute",
    left: -46,
    top: -7,
    width: 42,
    textAlign: "right",
    fontSize: 10.5,
    color: "#94a3b8",
    fontWeight: 600
  },
  hourLine: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    borderTop: "1px solid #f1f5f9"
  },
  nowLine: {
    position: "absolute",
    left: -4,
    right: 0,
    height: 2,
    background: "#dc2626",
    zIndex: 5
  },
  nowDot: {
    position: "absolute",
    left: -4,
    top: -3,
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#dc2626"
  },
  workCard: {
    background: "#fff",
    border: "1px solid #eef1f4",
    borderRadius: 12,
    padding: 12,
    marginTop: 12
  },
  workRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "5px 0"
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    border: "2px solid #cbd5e1",
    background: "#fff",
    cursor: "pointer",
    fontSize: 13,
    color: "#fff",
    flexShrink: 0,
    lineHeight: 1
  },
  checkOn: {
    background: "#16a34a",
    borderColor: "#16a34a"
  },
  xBtn: {
    width: 26,
    height: 26,
    border: "none",
    background: "none",
    fontSize: 22,
    color: "#cbd5e1",
    cursor: "pointer",
    lineHeight: 1,
    flexShrink: 0
  },
  input: {
    flex: 1,
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #e2e8f0",
    borderRadius: 9,
    padding: "9px 11px",
    fontSize: 14,
    outline: "none",
    background: "#fff",
    fontFamily: "inherit",
    color: "#1e293b"
  },
  addMini: {
    width: 38,
    border: "none",
    background: "#4f46e5",
    color: "#fff",
    borderRadius: 9,
    fontSize: 20,
    cursor: "pointer",
    flexShrink: 0
  },
  segWrap: {
    display: "flex",
    gap: 4,
    background: "#eef1f4",
    padding: 4,
    borderRadius: 10,
    marginBottom: 12
  },
  seg: {
    flex: 1,
    padding: "8px 0",
    border: "none",
    background: "none",
    borderRadius: 7,
    fontSize: 13.5,
    fontWeight: 700,
    color: "#64748b",
    cursor: "pointer"
  },
  segOn: {
    background: "#fff",
    color: "#1e293b",
    boxShadow: "0 1px 2px rgba(0,0,0,.08)"
  },
  taskCard: {
    width: "100%",
    background: "#fff",
    border: "1px solid #eef1f4",
    borderRadius: 11,
    padding: "11px 13px",
    cursor: "pointer",
    textAlign: "left"
  },
  empty: {
    textAlign: "center",
    color: "#94a3b8",
    fontSize: 13.5,
    padding: "30px 20px"
  },
  empty2: {
    color: "#94a3b8",
    fontSize: 12.5,
    lineHeight: 1.5,
    marginBottom: 12
  },
  fab: {
    position: "fixed",
    bottom: 78,
    left: "50%",
    transform: "translateX(-50%)",
    maxWidth: 220,
    background: "#4f46e5",
    color: "#fff",
    border: "none",
    borderRadius: 999,
    padding: "13px 26px",
    fontSize: 14.5,
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "0 4px 14px rgba(79,70,229,.4)",
    whiteSpace: "nowrap"
  },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,.4)",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    zIndex: 50
  },
  sheet: {
    width: "100%",
    maxWidth: 480,
    background: "#fff",
    borderRadius: "18px 18px 0 0",
    padding: "18px 18px calc(20px + env(safe-area-inset-bottom))",
    maxHeight: "90vh",
    overflowY: "auto"
  },
  select: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #e2e8f0",
    borderRadius: 9,
    padding: "9px 10px",
    fontSize: 14,
    background: "#fff",
    outline: "none",
    fontFamily: "inherit",
    color: "#1e293b"
  },
  primaryBtn: {
    background: "#4f46e5",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "11px 18px",
    fontSize: 14.5,
    fontWeight: 700,
    cursor: "pointer",
    flex: 1
  },
  ghostBtn: {
    background: "#f1f5f9",
    color: "#475569",
    border: "none",
    borderRadius: 10,
    padding: "11px 18px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    flex: 1
  },
  doneToggle: {
    width: "100%",
    marginTop: 12,
    background: "#f0fdf4",
    color: "#16a34a",
    border: "1px solid #bbf7d0",
    borderRadius: 9,
    padding: "9px",
    fontSize: 13.5,
    fontWeight: 700,
    cursor: "pointer"
  },
  doneOn: {
    background: "#16a34a",
    color: "#fff",
    borderColor: "#16a34a"
  },
  deleteBtn: {
    width: "100%",
    marginTop: 12,
    background: "none",
    color: "#dc2626",
    border: "1px solid #fecaca",
    borderRadius: 10,
    padding: "10px",
    fontSize: 13.5,
    fontWeight: 600,
    cursor: "pointer"
  },
  addTermin: {
    width: "100%",
    marginTop: 6,
    background: "#eef2ff",
    color: "#4f46e5",
    border: "1px dashed #c7d2fe",
    borderRadius: 9,
    padding: "9px",
    fontSize: 13.5,
    fontWeight: 700,
    cursor: "pointer"
  },
  schedBox: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    padding: 10,
    marginTop: 6
  },
  blockRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "#f8fafc",
    border: "1px solid #eef1f4",
    borderRadius: 8,
    padding: "7px 6px 7px 10px",
    marginBottom: 6
  },
  progressOuter: {
    height: 6,
    background: "#f1f5f9",
    borderRadius: 999,
    overflow: "hidden",
    margin: "4px 0 8px"
  },
  progressInner: {
    height: "100%",
    background: "#16a34a",
    borderRadius: 999,
    transition: "width .2s"
  }
};
const CSS = `
* { -webkit-tap-highlight-color: transparent; }
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
input:focus, select:focus, textarea:focus { border-color: #4f46e5 !important; }
button:active { opacity: .8; }
textarea { resize: vertical; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(App));
(function () {
  // ------------------------
  // Utilities (unchanged)
  // ------------------------
  window.showToast = function ({
    type = "info",
    message = "",
    duration = 3000,
  } = {}) {
    const container =
      document.getElementById("toast-container") || createToastContainer();
    const colors = {
      success: "background: #10b981;",
      error: "background: #ef4444;",
      info: "background: #3b82f6;",
      warning: "background: #f59e0b;",
    };
    const toast = document.createElement("div");
    toast.setAttribute("role", "status");
    toast.style.cssText = `${
      colors[type] || colors.info
    } color: #fff; padding:8px 12px; border-radius:8px; box-shadow:0 6px 18px rgba(0,0,0,0.08); margin-top:6px;`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 300);
    }, duration);
  };
  function createToastContainer() {
    let c = document.getElementById("toast-container");
    if (!c) {
      c = document.createElement("div");
      c.id = "toast-container";
      c.style.cssText =
        "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999";
      document.body.appendChild(c);
    }
    return c;
  }

  function initTheme() {
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;
    const sun = document.getElementById("sun-icon");
    const moon = document.getElementById("moon-icon");
    const setDark = (v) => {
      if (v) document.documentElement.classList.add("dark");
      else document.documentElement.classList.remove("dark");
      if (sun && moon) {
        sun.style.display = v ? "none" : "inline-block";
        moon.style.display = v ? "inline-block" : "none";
      }
    };
    const saved = localStorage.getItem("tt_dark") === "1";
    setDark(saved);
    btn.addEventListener("click", () => {
      const isDark = document.documentElement.classList.contains("dark");
      setDark(!isDark);
      localStorage.setItem("tt_dark", !isDark ? "1" : "0");
    });
  }
  function initProfileMenu() {
    const profileBtn = document.getElementById("profile-btn");
    const profileMenu = document.getElementById("profile-menu");
    if (!profileBtn || !profileMenu) return;
    profileBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      profileMenu.style.display =
        profileMenu.style.display === "block" ? "none" : "block";
    });
    document.addEventListener("click", (e) => {
      if (!profileMenu.contains(e.target) && e.target !== profileBtn)
        profileMenu.style.display = "none";
    });
  }
  function initPrint() {
    const btn = document.getElementById("btnPrint");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const content = document.getElementById("contentArea");
      const opt = {
        margin: 0,
        filename: "timetable.pdf",
        image: { type: "jpeg", quality: 1 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: "pt", format: "a4", orientation: "landscape" },
      };
      html2pdf().set(opt).from(content).save();
    });
  }
  function initViewControls() {
    const buttons = Array.from(
      document.querySelectorAll(".controls .btn[data-view]")
    );
    if (!buttons.length) return;

    // attach click handlers
    buttons.forEach((b) => {
      b.addEventListener("click", () => {
        buttons.forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        const view = b.getAttribute("data-view");
        // set currentView and re-render immediately
        currentView = view;
        // sync mobile select if exists
        const sel = document.getElementById("mobile-view-select");
        if (sel) sel.value = view;
        console.debug("[timetable] view switched ->", view);
        render();
      });
    });

    // initialize currentView from any button that already has 'active', otherwise first button
    const activeBtn =
      document.querySelector(".controls .btn.active[data-view]") || buttons[0];
    if (activeBtn) currentView = activeBtn.getAttribute("data-view");

    // mobile select fallback
    const sel = document.getElementById("mobile-view-select");
    if (sel) {
      sel.addEventListener("change", (e) => {
        const val = e.target.value;
        currentView = val;
        buttons.forEach((x) =>
          x.classList.toggle("active", x.getAttribute("data-view") === val)
        );
        console.debug("[timetable] mobile select ->", val);
        render();
      });
      // sync mobile select initial value
      sel.value = currentView;
    }

    // ensure we render the selected view at startup
    render();
  }

  // ------------------------
  // State & refs
  // ------------------------
  let DAYS = [],
    PERIODS = [],
    COLS = [],
    TIMES_ROWS = {},
    currentView = "classes";
  let contentArea,
    editorOverlay,
    editor,
    edTitle,
    edName,
    edType,
    edStart,
    edEnd,
    edAfter,
    edSave,
    edCancel,
    edDelete;
  const uid = (p = "x") => p + Math.random().toString(36).slice(2, 9);
  const fmt = (t) => t || "";

  function initializeDataFromBackend() {
    if (typeof SERVER_DATA === "undefined") {
      DAYS = [];
      PERIODS = [];
      COLS = [];
      return;
    }
    DAYS = SERVER_DATA.days || [];
    const serverPeriods = SERVER_DATA.periods || [];
    PERIODS = [];
    COLS = [];
    let periodCounter = 0;
    serverPeriods.forEach((p) => {
      const isRegularPeriod = !p.type || p.type === "period";
      if (isRegularPeriod) {
        PERIODS.push({ name: p.name, start: p.start_time, end: p.end_time });
        periodCounter++;
      } else {
        COLS.push({
          id: uid(p.type),
          type: p.type,
          label: p.name,
          after: periodCounter,
          start: p.start_time,
          end: p.end_time,
        });
      }
    });
  }

  // ---------- RENDER ----------
  function render() {
    if (!contentArea) return;
    contentArea.innerHTML = "";
    const gridData =
      currentView === "classes"
        ? SERVER_DATA && SERVER_DATA.classes_grid
          ? SERVER_DATA.classes_grid
          : {}
        : SERVER_DATA && SERVER_DATA.teachers_grid
        ? SERVER_DATA.teachers_grid
        : {};
    const titlePrefix = currentView === "classes" ? "Class" : "Teacher";
    const sortedNames = Object.keys(gridData).sort();

    if (sortedNames.length === 0) {
      contentArea.innerHTML = `<div class="bg-white dark:bg-slate-800 rounded-lg shadow p-6 text-center text-gray-500">No ${currentView} found.</div>`;
      return;
    }

    sortedNames.forEach((name) => {
      const card = document.createElement("div");
      card.className =
        "bg-white dark:bg-slate-800 rounded-2xl shadow-md p-4 mb-6 border border-gray-100 dark:border-slate-700";

      const cardHeader = document.createElement("div");
      // --- build card header (left = published, center = school, right = Class/Teacher) ---
      cardHeader.className = "flex items-center justify-between gap-4 mb-3";

      // determine publish date (try several fields)
      let publishedRaw =
        (SERVER_DATA &&
          SERVER_DATA.raw_meta &&
          (SERVER_DATA.raw_meta.publishedAt ||
            SERVER_DATA.raw_meta.published_at ||
            SERVER_DATA.raw_meta.createdAt ||
            SERVER_DATA.raw_meta.created_at)) ||
        null;
      let publishDate = publishedRaw
        ? new Date(publishedRaw).toLocaleDateString()
        : "N/A";

      // center title (school / timetable name)
      let centerTitle =
        typeof SERVER_DATA !== "undefined" &&
        SERVER_DATA.raw_meta &&
        (SERVER_DATA.raw_meta.name || SERVER_DATA.raw_meta.title)
          ? SERVER_DATA.raw_meta.name || SERVER_DATA.raw_meta.title
          : "Unnamed School";

      // right side shows whether it's Class: name or Teacher: name
      const rightLabel = `${titlePrefix}: ${name}`;

      cardHeader.innerHTML = `
 <div class="text-right">
    <div class="text-lg font-semibold text-indigo-600 dark:text-indigo-400">${rightLabel}</div>
</div>
<div class="flex-1 text-center">
    <div class="text-lg font-semibold text-gray-900 dark:text-gray-100">${centerTitle}</div>
</div>
<div class="text-sm text-gray-400 dark:text-gray-500">Dated: ${publishDate}</div>
`;

      card.appendChild(cardHeader);

      const tableContainer = document.createElement("div");
      // allow internal horizontal scroll if REALLY needed, but table will attempt to fit via table-fixed
      tableContainer.className = "w-full bg-transparent relative overflow-auto";
      tableContainer.appendChild(buildGridForEntity(gridData[name]));
      card.appendChild(tableContainer);
      contentArea.appendChild(card);
    });
  }

  function buildGridForEntity(gridData) {
    const cols = buildSequence();
    const table = createTimetableShell(cols);
    const tbody = document.createElement("tbody");

    DAYS.forEach((day, di) => {
      // day row
      const tr = document.createElement("tr");
      tr.className =
        "group odd:bg-white even:bg-gray-50 dark:odd:bg-transparent dark:even:bg-slate-900";

      // Day cell (button inside)
      const dayCell = Object.assign(document.createElement("td"), {
        className:
          "relative px-3 py-3 font-medium text-gray-200 bg-transparent align-top border border-gray-800 text-center whitespace-nowrap",
        textContent: day,
      });

      const dayBtn = document.createElement("button");
      dayBtn.className =
        "ml-2 inline-flex items-center justify-center w-7 h-7 rounded-md text-xs font-medium text-gray-300 bg-transparent border border-gray-700 opacity-0 group-hover:opacity-100 transition-opacity";
      dayBtn.title = "Toggle Times Row";
      dayBtn.onclick = (e) => {
        e.stopPropagation();
        toggleTimesRow(di);
      };
      dayBtn.textContent = TIMES_ROWS[di] ? "−" : "+";
      dayCell.appendChild(dayBtn);
      tr.appendChild(dayCell);

      // times row (if exists) appended before cells for visual order
      if (TIMES_ROWS[di]) {
        tbody.appendChild(createTimesRow(cols, di));
      }

      cols.forEach((col, ci) => {
        const td = document.createElement("td");
        td.dataset.colIndex = ci;
        // use fixed layout friendly classes and center
        td.className =
          "align-top border border-gray-800 dark:border-slate-700 px-2 py-2 text-center";

        if (col.type === "period") {
          const periodSlots =
            gridData && gridData[di] && gridData[di][col.idx]
              ? gridData[di][col.idx]
              : [];
          if (periodSlots.length > 0) {
            td.innerHTML = `<div class="flex flex-col items-center justify-center min-h-[44px]">${periodSlots
              .map(createSlotHtml)
              .join("")}</div>`;
          } else {
            td.innerHTML = `<div class="min-h-[44px]"></div>`;
          }
        } else {
          // special styling for break & assembly
          let extraClass = "";
          if (col.type === "break")
            extraClass =
              "bg-yellow-900/10 dark:bg-yellow-800/20 border-yellow-400/40";
          if (col.type === "assembly")
            extraClass =
              "bg-indigo-900/8 dark:bg-indigo-800/16 border-indigo-400/30";
          td.innerHTML = `<div class="flex items-center justify-center h-full min-h-[44px] ${extraClass}"><div class="text-sm font-medium whitespace-nowrap">${col.label}</div></div>`;
        }
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    tbody.addEventListener("click", handleCellClick);
    return table;
  }

  function createSlotHtml(slot) {
    const bg =
      slot.subject_color || slot.class_color || slot.teacher_color || "#e5e7eb";
    const subject = slot.subject || "-";
    const teacher = slot.teacher || "-";
    const className = slot.class || "-";
    // reduced padding and truncated text so badge won't force width
    return `<div class="mb-1 rounded-md px-2 py-1 border max-w-full truncate" style="border-color:${bg}; background:${bg}20; display:inline-block; text-align:left;">
              <div class="text-sm font-semibold text-gray-100 leading-5 truncate">${subject}</div>
              <div class="text-xs text-gray-300 mt-0.5 leading-4 truncate">${teacher} • ${className}</div>
            </div>`;
  }

  const buildSequence = () => {
    const seq = [];
    COLS.filter((c) => c.after === 0).forEach((c) => seq.push(c));
    PERIODS.forEach((p, i) => {
      seq.push({
        type: "period",
        idx: i,
        name: p.name,
        start: p.start,
        end: p.end,
      });
      COLS.filter((c) => c.after === i + 1).forEach((c) => seq.push(c));
    });
    return seq;
  };

  function createTimesRow(cols, dayIndex) {
    const tr = document.createElement("tr");
    tr.className = "bg-transparent";

    tr.appendChild(
      Object.assign(document.createElement("td"), {
        className:
          "px-3 py-2 text-sm font-medium text-gray-300 bg-transparent border border-gray-800 dark:border-slate-700",
        textContent: "Times",
      })
    );

    cols.forEach((col, ci) => {
      const td = document.createElement("td");
      td.contentEditable = "true";
      // nowrap so normal spaces won't break to new line
      td.className =
        "px-2 py-2 text-xs text-gray-300 border border-gray-800 bg-transparent text-center whitespace-nowrap overflow-hidden";
      td.textContent = TIMES_ROWS[dayIndex][ci];
      td.onblur = (e) => {
        // store trimmed text; preserve normal spaces
        TIMES_ROWS[dayIndex][ci] = e.target.textContent
          .replace(/\u00A0/g, " ")
          .trim();
      };
      tr.appendChild(td);
    });
    return tr;
  }

  function toggleTimesRow(dayIndex) {
    if (TIMES_ROWS[dayIndex]) delete TIMES_ROWS[dayIndex];
    else {
      const cols = buildSequence();
      TIMES_ROWS[dayIndex] = cols.map(
        (col) => `${fmt(col.start)}${col.end ? " - " + fmt(col.end) : ""}`
      );
    }
    render();
  }

  // create table header — using table-fixed keeps columns distributed evenly
  function createTimetableShell(cols) {
    const table = document.createElement("table");
    table.className =
      "w-full table-fixed border-collapse text-sm bg-transparent";
    const thead = document.createElement("thead");
    const thr = document.createElement("tr");

    thr.appendChild(
      Object.assign(document.createElement("th"), {
        textContent: "Day",
        className:
          "px-3 py-2 text-center font-medium text-gray-300 bg-transparent border border-gray-800 dark:border-slate-700 whitespace-nowrap",
      })
    );

    cols.forEach((col, ci) => {
      const th = document.createElement("th");
      th.className = "px-2 py-2 border border-gray-800 dark:border-slate-700";

      const wrapper = document.createElement("div");
      wrapper.className =
        "group relative flex items-center justify-center flex-col py-1 px-2";

      // left & right small controls on hover
      const leftBtn = document.createElement("button");
      leftBtn.className =
        "absolute left-1 top-1 w-7 h-7 rounded-full text-xs border border-gray-700 bg-transparent opacity-0 group-hover:opacity-100 transition-opacity";
      leftBtn.textContent = "+";
      leftBtn.title = "Add after this";
      leftBtn.onclick = (e) => {
        e.stopPropagation();
        onHeaderPlus(ci);
      };

      const rightBtn = document.createElement("button");
      rightBtn.className =
        "absolute right-1 top-1 w-7 h-7 rounded-full text-xs border border-gray-700 bg-transparent opacity-0 group-hover:opacity-100 transition-opacity";
      rightBtn.textContent = "×";
      rightBtn.title = "Delete";
      rightBtn.onclick = (e) => {
        e.stopPropagation();
        deleteColumn(ci);
      };

      const titleDiv = document.createElement("div");
      titleDiv.className =
        "flex flex-col items-center justify-center text-center px-3";

      // show both start & end for non-periods too (if present)
      const timesText = `${fmt(col.start)}${
        col.end ? " - " + fmt(col.end) : ""
      }`;
      const titleHtml = document.createElement("div");
      titleHtml.innerHTML = `<div class="text-sm font-medium text-gray-200 whitespace-nowrap">${
        col.type === "period" ? col.name : col.label
      }</div><div class="text-xs text-gray-400 whitespace-nowrap">${timesText}</div>`;
      titleHtml.onclick = () => openEditorForCol(ci);

      wrapper.appendChild(leftBtn);
      wrapper.appendChild(rightBtn);
      titleDiv.appendChild(titleHtml);
      wrapper.appendChild(titleDiv);
      th.appendChild(wrapper);
      thr.appendChild(th);
    });

    thead.appendChild(thr);
    table.appendChild(thead);
    return table;
  }

  const handleCellClick = (e) => {
    const cell = e.target.closest("td");
    if (cell && cell.dataset && cell.dataset.colIndex)
      openEditorForCol(parseInt(cell.dataset.colIndex));
  };

  const onHeaderPlus = (ci) => {
    const seq = buildSequence();
    let after = 0;
    for (let i = ci; i >= 0; i--) {
      if (seq[i] && seq[i].type === "period") {
        after = seq[i].idx + 1;
        break;
      }
    }
    const prev = PERIODS[after - 1],
      next = PERIODS[after];
    openEditor({
      mode: "add",
      type: "break",
      after,
      name: "Break",
      start: prev ? prev.end : "",
      end: next ? next.start : "",
    });
  };

  const deleteColumn = (ci) => {
    if (!confirm("Are you sure you want to delete this column?")) return;
    const col = buildSequence()[ci];
    if (!col) return;
    if (col.type === "period") {
      if (PERIODS.length > 1) PERIODS.splice(col.idx, 1);
      else alert("Cannot delete the last period.");
    } else {
      const idx = COLS.findIndex((c) => c.id === col.id);
      if (idx > -1) COLS.splice(idx, 1);
    }
    render();
  };

  const openEditorForCol = (ci) => {
    const col = buildSequence()[ci];
    if (!col) return;
    if (col.type === "period")
      openEditor({
        mode: "edit",
        type: "period",
        idx: col.idx,
        name: col.name,
        start: col.start,
        end: col.end,
      });
    else {
      const obj = COLS.find((c) => c.id === col.id);
      if (obj)
        openEditor({
          mode: "edit-col",
          type: obj.type,
          colid: obj.id,
          after: obj.after,
          name: obj.label,
          start: obj.start,
          end: obj.end,
        });
    }
  };

  const openEditor = (opts) => {
    fillEdAfter();
    editor.dataset.mode = opts.mode;
    editor.dataset.idx = opts.idx ?? "";
    editor.dataset.colid = opts.colid ?? "";
    edTitle.textContent = opts.mode.startsWith("add")
      ? "Add New Column"
      : "Edit Column";
    edName.value = opts.name || "";
    edType.value = opts.type || "break";
    edStart.value = opts.start || "";
    edEnd.value = opts.end || "";
    edAfter.value = opts.after ?? (opts.idx != null ? opts.idx : 0);
    edDelete.style.display =
      opts.mode === "edit-col" || (opts.mode === "edit" && PERIODS.length > 1)
        ? "block"
        : "none";
    edType.disabled = opts.mode === "edit";

    editorOverlay.style.display = "flex";
    editorOverlay.style.alignItems = "center";
    editorOverlay.style.justifyContent = "center";
    editorOverlay.style.background = "transparent";
    if (editor) {
      editor.classList.remove("absolute", "top-0", "left-0");
      editor.classList.add("mx-auto");
    }
    edName.focus();
  };
  const closeEditor = () => {
    editorOverlay.style.display = "none";
  };

  function fillEdAfter() {
    edAfter.innerHTML = "";
    edAfter.appendChild(
      Object.assign(document.createElement("option"), {
        value: 0,
        textContent: "Before P1",
      })
    );
    PERIODS.forEach((p, i) =>
      edAfter.appendChild(
        Object.assign(document.createElement("option"), {
          value: i + 1,
          textContent: `After ${p.name}`,
        })
      )
    );
  }

  function bindEditorButtons() {
    edCancel.addEventListener("click", closeEditor);
    edDelete.addEventListener("click", () => {
      if (!confirm("Are you sure you want to delete this?")) return;
      const mode = editor.dataset.mode;
      if (mode === "edit") {
        if (PERIODS.length > 1) PERIODS.splice(Number(editor.dataset.idx), 1);
        else alert("Cannot delete the last period.");
      } else if (mode === "edit-col") {
        COLS.splice(
          COLS.findIndex((c) => c.id === editor.dataset.colid),
          1
        );
      }
      closeEditor();
      render();
    });
    edSave.addEventListener("click", () => {
      const mode = editor.dataset.mode;
      const name = edName.value.trim(),
        start = edStart.value,
        end = edEnd.value,
        after = Number(edAfter.value),
        type = edType.value;
      if (!name || !start || !end) return alert("Please fill all fields.");
      if (new Date("1970-01-01T" + start) >= new Date("1970-01-01T" + end))
        return alert("Start time must be before end time.");
      if (mode === "add")
        COLS.push({ id: uid("c"), type, label: name, after, start, end });
      else if (mode === "edit") {
        const idx = Number(editor.dataset.idx);
        if (PERIODS[idx]) PERIODS[idx] = { ...PERIODS[idx], name, start, end };
      } else if (mode === "edit-col") {
        const c = COLS.find((x) => x.id === editor.dataset.colid);
        if (c) Object.assign(c, { label: name, start, end, after, type });
      }
      closeEditor();
      render();
    });
  }

  function bindGlobalHandlers() {
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeEditor();
    });
    editorOverlay.addEventListener("click", (e) => {
      if (e.target === editorOverlay) closeEditor();
    });
  }

  // init
  document.addEventListener("DOMContentLoaded", function () {
    initTheme();
    initProfileMenu();
    initPrint();
    initViewControls();
    contentArea = document.getElementById("contentArea");
    editorOverlay = document.getElementById("editorOverlay");
    editor = document.getElementById("editor");
    edTitle = document.getElementById("editorTitle");
    edName = document.getElementById("edName");
    edType = document.getElementById("edType");
    edStart = document.getElementById("edStart");
    edEnd = document.getElementById("edEnd");
    edAfter = document.getElementById("edAfter");
    edSave = document.getElementById("edSave");
    edCancel = document.getElementById("edCancel");
    edDelete = document.getElementById("edDelete");
    bindEditorButtons();
    bindGlobalHandlers();
    try {
      initializeDataFromBackend();
      render();
    } catch (err) {
      console.error("Timetable init error:", err);
    }
    document.addEventListener("viewchange", (ev) => {
      currentView = ev.detail.view || "classes";
      render();
    });
  });
})();

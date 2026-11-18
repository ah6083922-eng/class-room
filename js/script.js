"use strict";

(() => {
  const STORAGE_KEY = "classroom.student-records.v1";
  const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const el = (id) => document.getElementById(id);
  const studentDialog = el("studentDialog");
  const profileDialog = el("profileDialog");
  const confirmDialog = el("confirmDialog");
  const form = el("studentForm");
  const today = localDateString(new Date());
  let students = [];
  let pendingPhoto = "";
  let pendingDeleteId = "";
  let toastTimer;

  function localDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function averageOfAllMarks() {
    const marks = students.flatMap((student) => student.marks);
    return marks.length ? marks.reduce((sum, mark) => sum + Number(mark.score), 0) / marks.length : null;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function initials(name) {
    return String(name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
  }

  function averageOf(marks) {
    if (!Array.isArray(marks) || marks.length === 0) return null;
    return marks.reduce((sum, mark) => sum + Number(mark.score), 0) / marks.length;
  }

  function gradeFor(score) {
    if (score === null || !Number.isFinite(score)) return "—";
    if (score >= 90) return "A+";
    if (score >= 80) return "A";
    if (score >= 70) return "B";
    if (score >= 60) return "C";
    if (score >= 50) return "D";
    return "F";
  }

  function attendanceFor(student) {
    const entries = Object.values(student.attendance || {});
    if (!entries.length) return null;
    const attended = entries.filter((status) => status === "Present" || status === "Late").length;
    return attended / entries.length * 100;
  }

  function allAttendanceCounts() {
    const counts = { Present: 0, Absent: 0, Late: 0 };
    students.forEach((student) => Object.values(student.attendance || {}).forEach((status) => {
      if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status] += 1;
    }));
    return counts;
  }

  function toast(message, isError = false) {
    const region = el("toastRegion");
    const item = document.createElement("div");
    item.className = `toast${isError ? " error" : ""}`;
    item.textContent = message;
    region.appendChild(item);
    window.setTimeout(() => item.remove(), 3600);
  }

  function readStoredStudents() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) throw new Error("Saved student data is not a list.");
      return parsed.filter((student) =>
        student && typeof student.id === "string" &&
        typeof student.name === "string" && typeof student.roll === "string" &&
        typeof student.className === "string" && Array.isArray(student.marks) &&
        student.attendance && typeof student.attendance === "object"
      ).map((student) => ({
        ...student,
        status: student.status === "Inactive" ? "Inactive" : "Active",
        marks: student.marks.filter((mark) => mark && typeof mark.subject === "string" && Number.isFinite(Number(mark.score)))
          .map((mark) => ({ subject: mark.subject, score: Number(mark.score) })),
        attendance: student.attendance
      }));
    } catch (error) {
      console.error("Could not read student records from LocalStorage.", error);
      toast("Saved records could not be read. Check browser storage and reload.", true);
      return [];
    }
  }

  function persist(nextStudents) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextStudents));
      students = nextStudents;
      return true;
    } catch (error) {
      console.error("Could not save student records to LocalStorage.", error);
      toast("Changes could not be saved. Check available browser storage.", true);
      return false;
    }
  }

  function studentAvatar(student, large = false) {
    const className = large ? "profile-large-avatar" : "student-avatar";
    return student.photo
      ? `<span class="${className}"><img src="${escapeHtml(student.photo)}" alt=""></span>`
      : `<span class="${className}">${escapeHtml(initials(student.name))}</span>`;
  }

  function studentNameCell(student) {
    return `<div class="student-cell">${studentAvatar(student)}<span><strong>${escapeHtml(student.name)}</strong><small>${escapeHtml(student.email || "No email provided")}</small></span></div>`;
  }

  function statusBadge(status) {
    const inactiveClass = status === "Inactive" ? " inactive" : "";
    return `<span class="status-pill${inactiveClass}">${escapeHtml(status)}</span>`;
  }

  function renderDashboard() {
    const activeCount = students.filter((student) => student.status === "Active").length;
    const averages = students.map((student) => averageOf(student.marks)).filter((value) => value !== null);
    const overallAverage = averageOfAllMarks();
    const attendanceCounts = allAttendanceCounts();
    const attendanceTotal = attendanceCounts.Present + attendanceCounts.Absent + attendanceCounts.Late;
    const attendanceRate = attendanceTotal
      ? Math.round((attendanceCounts.Present + attendanceCounts.Late) / attendanceTotal * 100)
      : null;
    el("totalStudents").textContent = String(students.length);
    el("activeStudents").textContent = String(activeCount);
    el("averageMarks").textContent = overallAverage === null ? "—" : `${Math.round(overallAverage)}%`;
    el("averageUnit").textContent = "";
    el("attendanceRate").textContent = attendanceRate === null ? "—" : `${attendanceRate}%`;
    el("attendanceUnit").textContent = "";
    el("attendanceNote").textContent = attendanceTotal ? `${attendanceTotal} attendance records · late counts as attended` : "No attendance recorded yet";
    el("attendanceTotal").textContent = String(attendanceTotal);
    el("presentCount").textContent = String(attendanceCounts.Present);
    el("lateCount").textContent = String(attendanceCounts.Late);
    el("absentCount").textContent = String(attendanceCounts.Absent);
    el("navStudentCount").textContent = String(students.length);

    const recent = [...students].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")).slice(0, 4);
    el("recentStudents").innerHTML = recent.map((student) => {
      const avg = averageOf(student.marks);
      return `<tr><td>${studentNameCell(student)}</td><td>${escapeHtml(student.roll)}</td><td>${escapeHtml(student.className)}</td><td>${avg === null ? "—" : `<span class="grade-value">${Math.round(avg)}%</span>`}</td><td>${statusBadge(student.status)}</td><td><button class="row-action" type="button" data-action="view" data-id="${escapeHtml(student.id)}" aria-label="View ${escapeHtml(student.name)}">↗</button></td></tr>`;
    }).join("");
    el("recentEmpty").classList.toggle("hidden", recent.length > 0);
    el("recentStudents").closest(".table-scroll").classList.toggle("hidden", recent.length === 0);
    el("performanceEmpty").classList.toggle("hidden", averages.length > 0);
    drawPerformanceChart();
    drawAttendanceChart(attendanceCounts, attendanceTotal);
  }

  function renderStudents() {
    const search = el("studentSearch").value.trim().toLocaleLowerCase();
    const classValue = el("classFilter").value;
    const statusValue = el("statusFilter").value;
    const filtered = students.filter((student) => {
      const matchesSearch = !search || student.name.toLocaleLowerCase().includes(search) || student.roll.toLocaleLowerCase().includes(search);
      return matchesSearch && (!classValue || student.className === classValue) && (!statusValue || student.status === statusValue);
    }).sort((a, b) => a.name.localeCompare(b.name));
    el("studentsTable").innerHTML = filtered.map((student) => {
      const avg = averageOf(student.marks);
      return `<tr><td>${studentNameCell(student)}</td><td>${escapeHtml(student.roll)}</td><td>${escapeHtml(student.className)}</td><td>${escapeHtml(student.email || "—")}</td><td>${avg === null ? "—" : `<span class="grade-value">${Math.round(avg)}% · ${gradeFor(avg)}</span>`}</td><td>${statusBadge(student.status)}</td><td><div class="row-actions"><button class="row-action" type="button" data-action="view" data-id="${escapeHtml(student.id)}" aria-label="View ${escapeHtml(student.name)}">↗</button><button class="row-action" type="button" data-action="edit" data-id="${escapeHtml(student.id)}" aria-label="Edit ${escapeHtml(student.name)}">✎</button><button class="row-action delete" type="button" data-action="delete" data-id="${escapeHtml(student.id)}" aria-label="Delete ${escapeHtml(student.name)}">×</button></div></td></tr>`;
    }).join("");
    const empty = filtered.length === 0;
    el("studentsEmpty").classList.toggle("hidden", !empty);
    el("studentsTable").closest(".table-scroll").classList.toggle("hidden", empty);
    const hasFilters = Boolean(search || classValue || statusValue);
    el("studentsEmptyTitle").textContent = hasFilters ? "No matching students" : "No students yet";
    el("studentsEmptyText").textContent = hasFilters ? "Try changing your search or filters." : "Add your first student to start building your roster.";
    el("studentsEmpty").querySelector('[data-action="add-student"]').classList.toggle("hidden", hasFilters);
    el("studentResultCount").textContent = `${filtered.length} ${filtered.length === 1 ? "student" : "students"}${hasFilters ? ` · ${students.length} total` : ""}`;
    el("navStudentCount").textContent = String(students.length);
  }

  function refreshClassFilter() {
    const select = el("classFilter");
    const previous = select.value;
    const classes = [...new Set(students.map((student) => student.className).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    select.innerHTML = `<option value="">All classes</option>${classes.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}`;
    if (classes.includes(previous)) select.value = previous;
  }

  function attendanceTableRow(student, date) {
    const status = (student.attendance || {})[date] || "";
    return `<tr><td>${studentNameCell(student)}</td><td>${escapeHtml(student.roll)}</td><td>${escapeHtml(student.className)}</td><td><div class="attendance-control"><select class="attendance-select" data-id="${escapeHtml(student.id)}" aria-label="Attendance status for ${escapeHtml(student.name)}"><option value="">Select status</option><option value="Present"${status === "Present" ? " selected" : ""}>Present</option><option value="Absent"${status === "Absent" ? " selected" : ""}>Absent</option><option value="Late"${status === "Late" ? " selected" : ""}>Late</option></select><button class="button button-secondary save-attendance" type="button" data-action="save-attendance" data-id="${escapeHtml(student.id)}">${status ? "Update" : "Save"}</button>${status ? `<span class="saved-label">Saved</span>` : ""}</div></td><td></td></tr>`;
  }

  function renderAttendance() {
    const date = el("attendanceDate").value || today;
    const dateValue = new Date(`${date}T12:00:00`);
    const isToday = date === today;
    el("attendanceDateTitle").textContent = isToday ? "Today's register" : dateValue.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    const counts = { Present: 0, Absent: 0, Late: 0 };
    students.forEach((student) => {
      const status = (student.attendance || {})[date];
      if (status && counts[status] !== undefined) counts[status] += 1;
    });
    const marked = counts.Present + counts.Absent + counts.Late;
    el("dayPresent").textContent = String(counts.Present);
    el("dayAbsent").textContent = String(counts.Absent);
    el("dayLate").textContent = String(counts.Late);
    el("attendanceDateSummary").textContent = students.length
      ? `${marked} of ${students.length} students marked · Save each student's status as you go.`
      : "Add students to start taking attendance.";
    el("attendanceTable").innerHTML = [...students].sort((a, b) => a.name.localeCompare(b.name))
      .map((student) => attendanceTableRow(student, date)).join("");
    const empty = students.length === 0;
    el("attendanceEmpty").classList.toggle("hidden", !empty);
    el("attendanceTable").closest(".table-scroll").classList.toggle("hidden", empty);
  }

  function makeInsight(student) {
    const avg = averageOf(student.marks);
    const attendance = attendanceFor(student);
    const issues = [];
    if (avg !== null && avg < 60) issues.push("marks below 60%");
    if (attendance !== null && attendance < 75) issues.push("attendance below 75%");
    if (student.status === "Inactive") issues.push("enrollment is inactive");
    if (issues.length) {
      return {
        kind: "warning", icon: "!", title: `${student.name} may need a check-in`,
        body: `${issues.join(" and ")}. Consider reviewing their recent progress and checking whether additional support would help.`
      };
    }
    if (avg !== null && avg >= 85 && (attendance === null || attendance >= 90)) {
      return {
        kind: "success", icon: "↗", title: `${student.name} is making strong progress`,
        body: `Their average is ${Math.round(avg)}%${attendance === null ? "" : ` with ${Math.round(attendance)}% attendance`}. Consider recognizing this consistency.`
      };
    }
    if (avg === null && attendance === null) {
      return {
        kind: "neutral", icon: "i", title: `${student.name}’s record is just getting started`,
        body: "No marks or attendance are recorded yet. Add subject marks or take attendance to include this student in future summaries."
      };
    }
    const details = [];
    if (avg !== null) details.push(`an average of ${Math.round(avg)}%`);
    if (attendance !== null) details.push(`${Math.round(attendance)}% attendance`);
    return {
      kind: "neutral", icon: "•", title: `${student.name}’s progress is on record`,
      body: `Current records show ${details.join(" and ")}. Keep logging results to make the trend easier to follow.`
    };
  }

  function renderInsights() {
    const avg = averageOfAllMarks();
    const strong = students.filter((student) => {
      const attendance = attendanceFor(student);
      return attendance !== null && attendance >= 90;
    }).length;
    const needsAttention = students.filter((student) => {
      const score = averageOf(student.marks);
      const attendance = attendanceFor(student);
      return (score !== null && score < 60) || (attendance !== null && attendance < 75) || student.status === "Inactive";
    }).length;
    el("insightAverage").textContent = avg === null ? "—" : `${Math.round(avg)}%`;
    el("strongAttendanceCount").textContent = `${strong} ${strong === 1 ? "student" : "students"}`;
    el("attentionCount").textContent = `${needsAttention} ${needsAttention === 1 ? "student" : "students"}`;
    const list = el("insightsList");
    if (!students.length) {
      list.innerHTML = `<div class="insight-empty">Add student records to generate rule-based demo observations. No data leaves this browser.</div>`;
      return;
    }
    list.innerHTML = [...students].sort((a, b) => a.name.localeCompare(b.name)).map((student) => {
      const insight = makeInsight(student);
      return `<article class="insight-item"><span class="insight-item-icon ${insight.kind}">${escapeHtml(insight.icon)}</span><div><h3>${escapeHtml(insight.title)}</h3><p>${escapeHtml(insight.body)}</p></div></article>`;
    }).join("");
  }

  function renderAll() {
    refreshClassFilter();
    renderDashboard();
    renderStudents();
    renderAttendance();
    renderInsights();
  }

  function drawPerformanceChart() {
    const canvas = el("performanceChart");
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(bounds.width * ratio);
    canvas.height = Math.round(bounds.height * ratio);
    const context = canvas.getContext("2d");
    context.scale(ratio, ratio);
    const width = bounds.width;
    const height = bounds.height;
    context.clearRect(0, 0, width, height);
    const entries = students.map((student) => ({ name: student.name, average: averageOf(student.marks) }))
      .filter((entry) => entry.average !== null).sort((a, b) => b.average - a.average).slice(0, 6);
    if (!entries.length) return;
    const left = 31, right = 7, top = 13, bottom = 25;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    context.font = "9px Inter, sans-serif";
    context.textBaseline = "middle";
    for (let tick = 0; tick <= 100; tick += 25) {
      const y = top + plotHeight * (1 - tick / 100);
      context.beginPath();
      context.strokeStyle = "#edf0f5";
      context.lineWidth = 1;
      context.moveTo(left, y);
      context.lineTo(width - right, y);
      context.stroke();
      context.fillStyle = "#9ca7b6";
      context.textAlign = "right";
      context.fillText(String(tick), left - 7, y);
    }
    const slot = plotWidth / entries.length;
    const barWidth = Math.min(28, slot * .46);
    entries.forEach((entry, index) => {
      const x = left + slot * index + (slot - barWidth) / 2;
      const barHeight = Math.max(2, plotHeight * entry.average / 100);
      const y = top + plotHeight - barHeight;
      context.fillStyle = index === 0 ? "#6388f4" : "#91aaf5";
      context.beginPath();
      context.roundRect(x, y, barWidth, barHeight, [4, 4, 0, 0]);
      context.fill();
      context.fillStyle = "#78869a";
      context.textAlign = "center";
      context.fillText(entry.name.length > 9 ? `${entry.name.slice(0, 8)}…` : entry.name, x + barWidth / 2, height - 10);
    });
  }

  function drawAttendanceChart(counts, total) {
    const canvas = el("attendanceChart");
    const ratio = window.devicePixelRatio || 1;
    canvas.width = 157 * ratio;
    canvas.height = 157 * ratio;
    const context = canvas.getContext("2d");
    context.scale(ratio, ratio);
    context.clearRect(0, 0, 157, 157);
    const center = 78.5;
    const radius = 57;
    const lineWidth = 13;
    context.lineWidth = lineWidth;
    context.lineCap = "butt";
    context.beginPath();
    context.strokeStyle = "#edf1f6";
    context.arc(center, center, radius, 0, Math.PI * 2);
    context.stroke();
    if (!total) return;
    const segments = [
      { amount: counts.Present, color: "#5ab991" },
      { amount: counts.Late, color: "#edb45d" },
      { amount: counts.Absent, color: "#e4797d" }
    ];
    let start = -Math.PI / 2;
    segments.forEach((segment) => {
      if (!segment.amount) return;
      const end = start + segment.amount / total * Math.PI * 2;
      context.beginPath();
      context.strokeStyle = segment.color;
      context.arc(center, center, radius, start, end);
      context.stroke();
      start = end;
    });
  }

  function setPage(name) {
    const safeName = ["dashboard", "students", "attendance", "insights"].includes(name) ? name : "dashboard";
    $$(".page-section").forEach((section) => section.classList.toggle("active", section.id === `page-${safeName}`));
    $$(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.page === safeName));
    const label = { dashboard: "Overview", students: "Students", attendance: "Attendance", insights: "AI insights" }[safeName];
    el("pageBreadcrumb").textContent = label;
    el("sidebar").classList.remove("open");
    el("sidebarBackdrop").classList.remove("visible");
    if (safeName === "dashboard") window.requestAnimationFrame(drawPerformanceChart);
  }

  function appendSubjectRow(subject = "", score = "") {
    const row = document.createElement("div");
    row.className = "subject-row";
    row.innerHTML = `<input type="text" class="subject-name" maxlength="50" placeholder="Subject name" aria-label="Subject name" value="${escapeHtml(subject)}"><input type="number" class="subject-score" min="0" max="100" step="0.1" placeholder="0–100" aria-label="Marks out of 100" value="${score === "" ? "" : escapeHtml(score)}"><button class="remove-subject" type="button" aria-label="Remove subject">×</button>`;
    el("subjectRows").appendChild(row);
  }

  function resetStudentForm() {
    form.reset();
    el("studentId").value = "";
    el("subjectRows").innerHTML = "";
    el("formError").textContent = "";
    el("photoPreview").textContent = "＋";
    pendingPhoto = "";
    el("saveStudentButton").disabled = false;
    el("studentDialogTitle").textContent = "Add a student";
    el("formEyebrow").textContent = "STUDENT PROFILE";
    el("saveStudentButton").textContent = "Save student";
  }

  function openStudentForm(student = null) {
    resetStudentForm();
    if (student) {
      el("studentId").value = student.id;
      el("studentName").value = student.name;
      el("rollNumber").value = student.roll;
      el("studentClass").value = student.className;
      el("studentEmail").value = student.email || "";
      el("studentPhone").value = student.phone || "";
      el("studentStatus").value = student.status;
      el("studentDialogTitle").textContent = "Edit student";
      el("formEyebrow").textContent = "UPDATE PROFILE";
      el("saveStudentButton").textContent = "Save changes";
      pendingPhoto = student.photo || "";
      if (pendingPhoto) el("photoPreview").innerHTML = `<img src="${escapeHtml(pendingPhoto)}" alt="">`;
      student.marks.forEach((mark) => appendSubjectRow(mark.subject, mark.score));
    }
    studentDialog.showModal();
    window.setTimeout(() => el("studentName").focus(), 0);
  }

  function validateAndCollectForm() {
    const id = el("studentId").value;
    const name = el("studentName").value.trim();
    const roll = el("rollNumber").value.trim();
    const className = el("studentClass").value.trim();
    const email = el("studentEmail").value.trim();
    const phone = el("studentPhone").value.trim();
    const error = el("formError");
    error.textContent = "";
    if (!name || !roll || !className) {
      error.textContent = "Please fill in the student's name, roll number and class.";
      return null;
    }
    if (email && !el("studentEmail").checkValidity()) {
      error.textContent = "Enter a valid email address, or leave the email field blank.";
      el("studentEmail").focus();
      return null;
    }
    if (phone && !/^[+()\d.\-\s]{7,25}$/.test(phone)) {
      error.textContent = "Enter a valid phone number, or leave the phone field blank.";
      el("studentPhone").focus();
      return null;
    }
    const duplicate = students.some((student) => student.id !== id && student.roll.trim().toLocaleLowerCase() === roll.toLocaleLowerCase());
    if (duplicate) {
      error.textContent = "That roll number is already assigned to another student.";
      el("rollNumber").focus();
      return null;
    }
    const marks = [];
    const seenSubjects = new Set();
    for (const row of $$(".subject-row", el("subjectRows"))) {
      const subject = $(".subject-name", row).value.trim();
      const scoreText = $(".subject-score", row).value.trim();
      if (!subject && !scoreText) continue;
      if (!subject || !scoreText) {
        error.textContent = "Complete both the subject name and marks for each subject.";
        return null;
      }
      const score = Number(scoreText);
      if (!Number.isFinite(score) || score < 0 || score > 100) {
        error.textContent = "Marks must be a number from 0 to 100.";
        return null;
      }
      const key = subject.toLocaleLowerCase();
      if (seenSubjects.has(key)) {
        error.textContent = `“${subject}” is listed more than once. Each subject can only appear once.`;
        return null;
      }
      seenSubjects.add(key);
      marks.push({ subject, score });
    }
    const existing = students.find((student) => student.id === id);
    const record = {
      id: id || (window.crypto && typeof window.crypto.randomUUID === "function" ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`),
      name, roll, className, email, phone, status: el("studentStatus").value,
      photo: pendingPhoto,
      marks,
      attendance: existing ? existing.attendance : {},
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    return { record, existing };
  }

  function renderProfile(student) {
    const average = averageOf(student.marks);
    const attendance = attendanceFor(student);
    el("profileContent").innerHTML = `
      <div class="profile-hero">${studentAvatar(student, true)}<div><h2 id="profileName">${escapeHtml(student.name)}</h2><p>Roll ${escapeHtml(student.roll)} · ${escapeHtml(student.className)}</p></div></div>
      <div class="profile-info-grid">
        <div><span>Email</span><strong>${escapeHtml(student.email || "Not provided")}</strong></div>
        <div><span>Phone</span><strong>${escapeHtml(student.phone || "Not provided")}</strong></div>
        <div><span>Enrollment status</span><strong>${escapeHtml(student.status)}</strong></div>
        <div><span>Attendance</span><strong>${attendance === null ? "Not recorded" : `${Math.round(attendance)}% attended`}</strong></div>
        <div><span>Average marks</span><strong>${average === null ? "No marks yet" : `${Math.round(average)}% · Grade ${gradeFor(average)}`}</strong></div>
        <div><span>Subjects recorded</span><strong>${student.marks.length}</strong></div>
      </div>
      <div class="profile-section-title"><span>Subject marks</span><span>${student.marks.length} ${student.marks.length === 1 ? "subject" : "subjects"}</span></div>
      ${student.marks.length ? student.marks.map((mark) => `<div class="profile-mark-row"><span>${escapeHtml(mark.subject)}</span><strong>${escapeHtml(mark.score)} / 100</strong><strong>${gradeFor(mark.score)}</strong></div>`).join("") : `<div class="profile-empty">No subject marks recorded. Edit this student to add marks.</div>`}
      <div class="profile-section-title"><span>Attendance history</span><span>${Object.keys(student.attendance || {}).length} ${Object.keys(student.attendance || {}).length === 1 ? "day" : "days"}</span></div>
      ${Object.entries(student.attendance || {}).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6).map(([date, status]) => `<div class="profile-mark-row"><span>${escapeHtml(new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }))}</span><strong>${escapeHtml(status)}</strong><span></span></div>`).join("") || `<div class="profile-empty">No attendance recorded yet.</div>`}
      <div class="profile-actions"><button class="button button-secondary" type="button" data-action="edit" data-id="${escapeHtml(student.id)}">Edit profile</button><button class="button button-primary" type="button" data-action="profile-marks" data-id="${escapeHtml(student.id)}">Manage marks</button></div>`;
  }

  function exportCsv() {
    if (!students.length) {
      toast("There are no student records to export.", true);
      return;
    }
    const headers = ["Name", "Roll Number", "Class", "Email", "Phone", "Status", "Average Marks", "Grade", "Subject Marks", "Attendance Rate", "Attendance Records"];
    const rows = [...students].sort((a, b) => a.name.localeCompare(b.name)).map((student) => {
      const avg = averageOf(student.marks);
      const attendance = attendanceFor(student);
      const marksText = student.marks.map((mark) => `${mark.subject}: ${mark.score}`).join("; ");
      const attendanceText = Object.entries(student.attendance || {}).map(([date, status]) => `${date}: ${status}`).join("; ");
      return [student.name, student.roll, student.className, student.email, student.phone, student.status,
        avg === null ? "" : Math.round(avg), avg === null ? "" : gradeFor(avg), marksText,
        attendance === null ? "" : `${Math.round(attendance)}%`, attendanceText];
    });
    const quote = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map((row) => row.map(quote).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `student-records-${today}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Exported ${students.length} student records to CSV.`);
  }

  function openDeleteConfirmation(student) {
    pendingDeleteId = student.id;
    el("confirmCopy").textContent = `${student.name} (${student.roll}) and their marks and attendance will be permanently removed from this browser.`;
    confirmDialog.showModal();
  }

  function handleRecordAction(action, id) {
    const student = students.find((entry) => entry.id === id);
    if (!student) return;
    if (action === "view") {
      renderProfile(student);
      profileDialog.showModal();
    } else if (action === "edit") {
      if (profileDialog.open) profileDialog.close();
      openStudentForm(student);
    } else if (action === "delete") {
      openDeleteConfirmation(student);
    } else if (action === "profile-marks") {
      profileDialog.close();
      openStudentForm(student);
    }
  }

  function handleClick(event) {
    const pageButton = event.target.closest("[data-page]");
    if (pageButton) {
      event.preventDefault();
      setPage(pageButton.dataset.page);
      return;
    }
    const closeButton = event.target.closest("[data-close-dialog]");
    if (closeButton) {
      closeButton.closest("dialog").close();
      return;
    }
    const actionButton = event.target.closest("[data-action]");
    if (actionButton) {
      const { action, id } = actionButton.dataset;
      if (action === "add-student") openStudentForm();
      else if (action === "view" || action === "edit" || action === "delete" || action === "profile-marks") handleRecordAction(action, id);
      else if (action === "save-attendance") saveAttendance(id, actionButton);
      return;
    }
  }

  function saveAttendance(id, button) {
    const student = students.find((entry) => entry.id === id);
    const select = button.parentElement.querySelector(".attendance-select");
    if (!student || !select || !select.value) {
      toast("Choose Present, Absent or Late before saving.", true);
      if (select) select.focus();
      return;
    }
    const date = el("attendanceDate").value || today;
    const next = students.map((entry) => entry.id === id
      ? { ...entry, attendance: { ...(entry.attendance || {}), [date]: select.value }, updatedAt: new Date().toISOString() }
      : entry);
    if (persist(next)) {
      renderAll();
      toast(`Attendance saved for ${student.name}.`);
    }
  }

  function updateAttendanceStatusCounts() {
    const counts = { Present: 0, Absent: 0, Late: 0 };
    $$(".attendance-select").forEach((select) => {
      if (counts[select.value] !== undefined) counts[select.value] += 1;
    });
    el("dayPresent").textContent = String(counts.Present);
    el("dayAbsent").textContent = String(counts.Absent);
    el("dayLate").textContent = String(counts.Late);
  }

  function handlePhotoChange(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast("Choose a JPG, PNG or WebP image.", true);
      event.target.value = "";
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      toast("The photo must be 2 MB or smaller.", true);
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    el("saveStudentButton").disabled = true;
    reader.addEventListener("load", () => {
      el("saveStudentButton").disabled = false;
      if (typeof reader.result !== "string") {
        toast("The selected photo could not be read.", true);
        return;
      }
      pendingPhoto = reader.result;
      el("photoPreview").innerHTML = `<img src="${escapeHtml(pendingPhoto)}" alt="Selected profile photo">`;
    });
    reader.addEventListener("error", () => {
      el("saveStudentButton").disabled = false;
      toast("The selected photo could not be read.", true);
    });
    reader.readAsDataURL(file);
  }

  function setCurrentDate() {
    const date = new Date();
    el("todayLabel").textContent = date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    el("welcomeDate").textContent = date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }).toUpperCase();
    const hour = date.getHours();
    $("h1").firstChild.textContent = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    el("attendanceDate").value = today;
  }

  function initialize() {
    students = readStoredStudents();
    setCurrentDate();
    renderAll();
    document.addEventListener("click", handleClick);
    el("studentSearch").addEventListener("input", renderStudents);
    el("classFilter").addEventListener("change", renderStudents);
    el("statusFilter").addEventListener("change", renderStudents);
    el("attendanceDate").addEventListener("change", renderAttendance);
    el("attendanceTable").addEventListener("change", (event) => {
      if (event.target.matches(".attendance-select")) updateAttendanceStatusCounts();
    });
    el("addSubject").addEventListener("click", () => appendSubjectRow());
    el("subjectRows").addEventListener("click", (event) => {
      const removeButton = event.target.closest(".remove-subject");
      if (removeButton) removeButton.closest(".subject-row").remove();
    });
    el("studentPhoto").addEventListener("change", handlePhotoChange);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const result = validateAndCollectForm();
      if (!result) return;
      const { record, existing } = result;
      const next = existing
        ? students.map((student) => student.id === existing.id ? record : student)
        : [...students, record];
      if (persist(next)) {
        studentDialog.close();
        renderAll();
        toast(existing ? "Student record updated." : "Student added to your roster.");
      }
    });
    el("confirmDelete").addEventListener("click", () => {
      const student = students.find((entry) => entry.id === pendingDeleteId);
      if (!student) {
        confirmDialog.close();
        return;
      }
      if (persist(students.filter((entry) => entry.id !== pendingDeleteId))) {
        confirmDialog.close();
        pendingDeleteId = "";
        renderAll();
        toast("Student record deleted.");
      }
    });
    el("exportCsv").addEventListener("click", exportCsv);
    el("helpButton").addEventListener("click", () => toast("Classroom keeps your records in this browser only. Use Export CSV to download a copy; demo insights are rule-based, not AI-powered."));
    el("menuToggle").addEventListener("click", () => {
      el("sidebar").classList.add("open");
      el("sidebarBackdrop").classList.add("visible");
    });
    el("sidebarBackdrop").addEventListener("click", () => {
      el("sidebar").classList.remove("open");
      el("sidebarBackdrop").classList.remove("visible");
    });
    window.addEventListener("resize", () => window.requestAnimationFrame(drawPerformanceChart));
    studentDialog.addEventListener("close", resetStudentForm);
  }

  initialize();
})();
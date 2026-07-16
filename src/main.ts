declare const require: (name: string) => any;
declare const module: { exports: any };

const { Plugin: ObsidianPlugin, ItemView, Modal, PluginSettingTab, Setting } = require("obsidian");

const VIEW_TYPE = "progress-dock-view";
const COLORS = ["#5b67f1", "#ff8b61", "#26a985", "#aa6ee8", "#e7ad32"];

const DEFAULT_DATA = {
  tasks: [],
  deadlines: [],
  roadmaps: [],
  settings: { openOnStartup: false, defaultTab: "overview" },
};

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function taskPercent(task: any) {
  const current = Number(task.current);
  const target = Number(task.target);
  if (!Number.isFinite(current) || !Number.isFinite(target) || target <= 0) return 0;
  return Math.round(clamp((current / target) * 100, 0, 100));
}

function taskStep(task: any) {
  if (Number(task.target) <= 10) return 0.1;
  if (Number(task.target) <= 100) return 1;
  return Math.max(1, Math.round(Number(task.target) / 100));
}

function dateKey(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function toLocalDateTime(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatDeadline(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function countdown(value: string) {
  const diff = new Date(value).getTime() - Date.now();
  const overdue = diff < 0;
  const absolute = Math.abs(diff);
  const days = Math.floor(absolute / 86_400_000);
  const hours = Math.floor((absolute % 86_400_000) / 3_600_000);
  const minutes = Math.floor((absolute % 3_600_000) / 60_000);
  if (overdue) return { text: `已逾期 ${days ? `${days} 天` : `${Math.max(hours, 1)} 小时`}`, urgent: true, overdue: true };
  if (days) return { text: `${days} 天 ${hours} 小时`, urgent: days <= 3, overdue: false };
  return { text: `${hours} 小时 ${minutes} 分`, urgent: true, overdue: false };
}

function parseRoadmap(value: string) {
  return value.split(/\s*(?:->|→|⇒|\n|，|,)\s*/)
    .map((stage) => stage.split(/\s*(?:\+|\||｜|＆)\s*/).map((step) => step.trim()).filter(Boolean))
    .filter((stage) => stage.length > 0);
}

function groupRoadmap(roadmap: any) {
  const groups = new Map<number, any[]>();
  (roadmap.steps || []).forEach((step: any, index: number) => {
    const stage = step.stage ?? index;
    groups.set(stage, [...(groups.get(stage) || []), step]);
  });
  return Array.from(groups.entries()).sort(([a], [b]) => a - b).map(([, steps]) => steps);
}

function el(tag: string, className = "", text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function button(text: string, className: string, handler: (event: MouseEvent) => void) {
  const element = el("button", className, text) as HTMLButtonElement;
  element.type = "button";
  element.addEventListener("click", handler);
  return element;
}

function field(labelText: string, input: HTMLElement, help = "") {
  const label = el("label", "pd-field");
  label.append(el("span", "", labelText), input);
  if (help) label.append(el("small", "", help));
  return label;
}

class TaskModal extends Modal {
  plugin: any;
  task: any;

  constructor(app: any, plugin: any, task?: any) {
    super(app);
    this.plugin = plugin;
    this.task = task;
  }

  onOpen() {
    this.titleEl.textContent = this.task ? "编辑任务" : "新建任务";
    this.contentEl.replaceChildren();
    const form = el("form", "pd-form") as HTMLFormElement;
    const title = Object.assign(el("input") as HTMLInputElement, { required: true, value: this.task?.title || "", placeholder: "例如：完成课程项目" });
    const category = Object.assign(el("input") as HTMLInputElement, { value: this.task?.category || "学习", placeholder: "学习" });
    const current = Object.assign(el("input") as HTMLInputElement, { type: "number", min: "0", step: "any", required: true, value: String(this.task?.current ?? 0) });
    const target = Object.assign(el("input") as HTMLInputElement, { type: "number", min: "0.01", step: "any", required: true, value: String(this.task?.target ?? 100) });
    const unit = Object.assign(el("input") as HTMLInputElement, { value: this.task?.unit || "%", placeholder: "页 / 次 / %" });
    const display = el("select") as HTMLSelectElement;
    [["bar", "进度条"], ["ring", "圆环"], ["number", "数字"]].forEach(([value, text]) => {
      const option = el("option", "", text) as HTMLOptionElement;
      option.value = value;
      option.selected = value === (this.task?.display || "bar");
      display.append(option);
    });
    const color = Object.assign(el("input") as HTMLInputElement, { type: "color", value: this.task?.color || COLORS[0] });
    form.append(field("任务名称", title), field("分类", category), field("当前数值", current), field("目标数值", target), field("单位", unit), field("展示方式", display), field("强调色", color));
    const actions = el("div", "pd-form-actions");
    if (this.task) actions.append(button("删除", "pd-danger", () => {
      if (!window.confirm("确定删除这个任务吗？")) return;
      this.plugin.data.tasks = this.plugin.data.tasks.filter((item: any) => item.id !== this.task.id);
      this.plugin.persistAndRender();
      this.close();
    }));
    actions.append(button("取消", "pd-secondary", () => this.close()));
    const submit = el("button", "pd-primary", this.task ? "保存" : "创建") as HTMLButtonElement;
    submit.type = "submit";
    actions.append(submit);
    form.append(actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = {
        id: this.task?.id || uid(), title: title.value.trim(), category: category.value.trim() || "未分类",
        current: Math.max(0, Number(current.value)), target: Math.max(0.01, Number(target.value)),
        unit: unit.value.trim(), display: display.value, color: color.value,
      };
      const index = this.plugin.data.tasks.findIndex((item: any) => item.id === value.id);
      if (index >= 0) this.plugin.data.tasks[index] = value;
      else this.plugin.data.tasks.unshift(value);
      this.plugin.persistAndRender();
      this.close();
    });
    this.contentEl.append(form);
    title.focus();
  }
}

class DeadlineModal extends Modal {
  plugin: any;
  deadline: any;

  constructor(app: any, plugin: any, deadline?: any) {
    super(app);
    this.plugin = plugin;
    this.deadline = deadline;
  }

  onOpen() {
    this.titleEl.textContent = this.deadline ? "编辑 DDL" : "添加 DDL";
    this.contentEl.replaceChildren();
    const form = el("form", "pd-form") as HTMLFormElement;
    const title = Object.assign(el("input") as HTMLInputElement, { required: true, value: this.deadline?.title || "", placeholder: "例如：课程论文终稿" });
    const when = Object.assign(el("input") as HTMLInputElement, { type: "datetime-local", required: true, value: this.deadline?.date || toLocalDateTime(new Date(Date.now() + 86_400_000)) });
    const category = Object.assign(el("input") as HTMLInputElement, { value: this.deadline?.category || "课程", placeholder: "课程 / 考试 / 工作" });
    const note = Object.assign(el("textarea") as HTMLTextAreaElement, { value: this.deadline?.note || "", placeholder: "提交要求、地点或提醒事项", rows: 3 });
    const color = Object.assign(el("input") as HTMLInputElement, { type: "color", value: this.deadline?.color || COLORS[1] });
    form.append(field("DDL 名称", title), field("日期与时间", when), field("分类", category), field("备注", note), field("强调色", color));
    const actions = el("div", "pd-form-actions");
    if (this.deadline) actions.append(button("删除", "pd-danger", () => {
      if (!window.confirm("确定删除这个 DDL 吗？")) return;
      this.plugin.data.deadlines = this.plugin.data.deadlines.filter((item: any) => item.id !== this.deadline.id);
      this.plugin.persistAndRender();
      this.close();
    }));
    actions.append(button("取消", "pd-secondary", () => this.close()));
    const submit = el("button", "pd-primary", this.deadline ? "保存" : "添加") as HTMLButtonElement;
    submit.type = "submit";
    actions.append(submit);
    form.append(actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = { id: this.deadline?.id || uid(), title: title.value.trim(), date: when.value, category: category.value.trim() || "未分类", note: note.value.trim(), color: color.value };
      const index = this.plugin.data.deadlines.findIndex((item: any) => item.id === value.id);
      if (index >= 0) this.plugin.data.deadlines[index] = value;
      else this.plugin.data.deadlines.push(value);
      this.plugin.persistAndRender();
      this.close();
    });
    this.contentEl.append(form);
    title.focus();
  }
}

class RoadmapModal extends Modal {
  plugin: any;
  roadmap: any;

  constructor(app: any, plugin: any, roadmap?: any) {
    super(app);
    this.plugin = plugin;
    this.roadmap = roadmap;
  }

  onOpen() {
    this.titleEl.textContent = this.roadmap ? "编辑学习路线" : "创建学习路线";
    this.contentEl.replaceChildren();
    const form = el("form", "pd-form") as HTMLFormElement;
    const title = Object.assign(el("input") as HTMLInputElement, { required: true, value: this.roadmap?.title || "", placeholder: "例如：前端 Web 学习路线" });
    const initialPath = this.roadmap ? groupRoadmap(this.roadmap).map((stage: any[]) => stage.map((step) => step.title).join(" + ")).join(" -> ") : "";
    const path = Object.assign(el("textarea") as HTMLTextAreaElement, { required: true, value: initialPath, placeholder: "HTML / CSS -> JavaScript -> React + Vue -> 项目实战", rows: 5 });
    form.append(field("路线名称", title), field("步骤与分支", path, "→ 进入下一阶段；+ 或 | 创建同阶段的并行分支。"));
    const preview = el("div", "pd-route-preview");
    const updatePreview = () => {
      preview.replaceChildren(el("span", "", "路线预览"));
      const row = el("div");
      parseRoadmap(path.value).slice(0, 6).forEach((stage: string[], index: number) => {
        const item = el("span");
        item.append(el("b", "", String(index + 1)), document.createTextNode(stage.join(" + ")));
        row.append(item);
      });
      preview.append(row);
    };
    path.addEventListener("input", updatePreview);
    updatePreview();
    form.append(preview);
    const actions = el("div", "pd-form-actions");
    if (this.roadmap) actions.append(button("删除", "pd-danger", () => {
      if (!window.confirm("确定删除这条学习路线吗？")) return;
      this.plugin.data.roadmaps = this.plugin.data.roadmaps.filter((item: any) => item.id !== this.roadmap.id);
      this.plugin.persistAndRender();
      this.close();
    }));
    actions.append(button("取消", "pd-secondary", () => this.close()));
    const submit = el("button", "pd-primary", this.roadmap ? "保存" : "创建") as HTMLButtonElement;
    submit.type = "submit";
    actions.append(submit);
    form.append(actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const stages = parseRoadmap(path.value);
      if (!stages.length) return;
      const steps = stages.flatMap((stage: string[], stageIndex: number) => stage.map((stepTitle) => {
        const existing = this.roadmap?.steps?.find((step: any) => step.title === stepTitle);
        return { id: existing?.id || uid(), title: stepTitle, done: existing?.done || false, stage: stageIndex };
      }));
      const value = { id: this.roadmap?.id || uid(), title: title.value.trim(), steps };
      const index = this.plugin.data.roadmaps.findIndex((item: any) => item.id === value.id);
      if (index >= 0) this.plugin.data.roadmaps[index] = value;
      else this.plugin.data.roadmaps.unshift(value);
      this.plugin.persistAndRender();
      this.close();
    });
    this.contentEl.append(form);
    title.focus();
  }
}

class ProgressDockView extends ItemView {
  plugin: any;
  currentTab: string;
  deadlineMode = "calendar";
  calendarCursor = new Date();

  constructor(leaf: any, plugin: any) {
    super(leaf);
    this.plugin = plugin;
    this.currentTab = plugin.data.settings.defaultTab || "overview";
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "进度舱"; }
  getIcon() { return "gauge"; }

  async onOpen() {
    this.contentEl.addClass("progress-dock-plugin");
    this.render();
    this.registerInterval(window.setInterval(() => this.render(), 60_000));
  }

  render() {
    const root = this.contentEl;
    root.replaceChildren();
    const header = el("header", "pd-header");
    const mark = el("span", "pd-mark");
    mark.append(el("i"), el("i"), el("i"));
    const brand = el("div");
    brand.append(el("strong", "", "进度舱"), el("small", "", new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" }).format(new Date())));
    header.append(mark, brand, button("＋", "pd-header-add", () => this.openContextModal()));
    root.append(header);

    const nav = el("nav", "pd-tabs");
    [["overview", "总览"], ["tasks", "进度"], ["roadmaps", "路线"], ["deadlines", "DDL"]].forEach(([id, label]) => {
      const item = button(label, this.currentTab === id ? "is-active" : "", () => { this.currentTab = id; this.render(); });
      nav.append(item);
    });
    root.append(nav);
    const body = el("main", "pd-body");
    root.append(body);
    if (this.currentTab === "tasks") this.renderTasks(body);
    else if (this.currentTab === "roadmaps") this.renderRoadmaps(body);
    else if (this.currentTab === "deadlines") this.renderDeadlines(body);
    else this.renderOverview(body);
  }

  openContextModal() {
    if (this.currentTab === "deadlines") new DeadlineModal(this.app, this.plugin).open();
    else if (this.currentTab === "roadmaps") new RoadmapModal(this.app, this.plugin).open();
    else new TaskModal(this.app, this.plugin).open();
  }

  sectionHeading(parent: HTMLElement, eyebrow: string, title: string, actionText = "", action?: () => void) {
    const heading = el("div", "pd-section-heading");
    const copy = el("div");
    copy.append(el("span", "", eyebrow), el("h3", "", title));
    heading.append(copy);
    if (actionText && action) heading.append(button(actionText, "pd-link-button", action));
    parent.append(heading);
    return heading;
  }

  renderOverview(parent: HTMLElement) {
    const tasks = this.plugin.data.tasks;
    const deadlines = this.sortedDeadlines();
    const average = tasks.length ? Math.round(tasks.reduce((sum: number, task: any) => sum + taskPercent(task), 0) / tasks.length) : 0;
    const next = deadlines.find((item: any) => new Date(item.date).getTime() >= Date.now());
    const stats = el("section", "pd-stats");
    const progress = el("article", "pd-stat pd-stat-primary");
    progress.append(el("span", "", "总体进度"), el("strong", "", `${average}%`), el("small", "", `${tasks.length} 个任务`));
    const ddl = el("article", "pd-stat");
    ddl.append(el("span", "", "最近 DDL"), el("strong", "", next ? countdown(next.date).text : "暂无"), el("small", "", next?.title || "没有临近事项"));
    stats.append(progress, ddl);
    parent.append(stats);

    this.sectionHeading(parent, "PROGRESS", "正在推进", "全部", () => { this.currentTab = "tasks"; this.render(); });
    const taskList = el("div", "pd-task-list");
    const active = tasks.filter((task: any) => taskPercent(task) < 100).slice(0, 3);
    if (active.length) active.forEach((task: any) => this.renderTaskCard(taskList, task));
    else taskList.append(this.empty("还没有进行中的任务", "添加一个可量化的目标", () => new TaskModal(this.app, this.plugin).open()));
    parent.append(taskList);

    const ddlWrap = el("section", "pd-ddl-preview");
    const ddlHeading = this.sectionHeading(ddlWrap, "UPCOMING", "最近 DDL", "添加", () => new DeadlineModal(this.app, this.plugin).open());
    ddlHeading.classList.add("pd-ddl-hover-heading");
    ddlHeading.tabIndex = 0;
    ddlHeading.setAttribute("aria-label", "最近 DDL，悬停查看全部 DDL 日历");
    ddlHeading.append(this.buildMiniCalendar(deadlines));
    if (deadlines.length) deadlines.slice(0, 4).forEach((item: any) => ddlWrap.append(this.deadlineRow(item)));
    else ddlWrap.append(this.empty("还没有 DDL", "记录下一个交付日期", () => new DeadlineModal(this.app, this.plugin).open()));
    parent.append(ddlWrap);
  }

  renderTasks(parent: HTMLElement) {
    this.sectionHeading(parent, "PROGRESS TRACKER", "任务进度", "新建", () => new TaskModal(this.app, this.plugin).open());
    const list = el("div", "pd-task-list");
    if (this.plugin.data.tasks.length) this.plugin.data.tasks.forEach((task: any) => this.renderTaskCard(list, task, true));
    else list.append(this.empty("还没有任务", "设置当前值、目标值与单位", () => new TaskModal(this.app, this.plugin).open()));
    parent.append(list);
  }

  renderTaskCard(parent: HTMLElement, task: any, showEdit = false) {
    const card = el("article", "pd-task-card");
    card.style.setProperty("--pd-color", task.color || COLORS[0]);
    card.style.setProperty("--pd-progress", `${taskPercent(task)}%`);
    const top = el("div", "pd-task-top");
    const copy = el("div");
    copy.append(el("span", "", task.category || "未分类"), el("strong", "", task.title));
    top.append(copy);
    if (showEdit) top.append(button("•••", "pd-more", () => new TaskModal(this.app, this.plugin, task).open()));
    card.append(top);

    const visual = el("div", `pd-task-visual is-${task.display || "bar"}`);
    const refreshVisual = () => {
      const value = taskPercent(task);
      card.style.setProperty("--pd-progress", `${value}%`);
      visual.replaceChildren();
      if (task.display === "ring") {
        const ring = el("div", "pd-ring");
        ring.style.background = `conic-gradient(${task.color || COLORS[0]} ${value}%, var(--background-modifier-border) ${value}% 100%)`;
        ring.append(el("span", "", `${value}%`));
        visual.append(ring);
      } else if (task.display === "number") {
        visual.append(el("strong", "", String(task.current)), el("span", "", `/ ${task.target} ${task.unit || ""}`), el("b", "", `${value}%`));
      } else {
        const row = el("div", "pd-bar-copy");
        row.append(
          el("strong", "", `${value}%`),
          el("span", "", `${task.current} / ${task.target} ${task.unit || ""}`),
        );
        const track = el("div", "pd-track");
        const fill = el("i");
        fill.style.setProperty("width", `${value}%`, "important");
        fill.style.background = task.color || COLORS[0];
        track.append(fill);
        visual.append(row, track);
      }
    };
    refreshVisual();
    card.append(visual);

    const controls = el("div", "pd-task-controls");
    const range = Object.assign(el("input", "pd-range") as HTMLInputElement, { type: "range", min: "0", max: String(task.target), step: String(taskStep(task)), value: String(clamp(task.current, 0, task.target)) });
    range.style.accentColor = task.color || COLORS[0];
    const number = Object.assign(el("input", "pd-number") as HTMLInputElement, { type: "number", min: "0", max: String(task.target), step: String(taskStep(task)), value: String(clamp(task.current, 0, task.target)), title: "点击输入当前进度" });
    const targetNumber = Object.assign(el("input", "pd-number pd-target-number") as HTMLInputElement, { type: "number", min: "0.01", step: "any", value: String(task.target), title: "点击输入目标数值" });
    range.setAttribute("aria-label", `拖动调整${task.title}进度`);
    number.setAttribute("aria-label", `${task.title}当前数值`);
    targetNumber.setAttribute("aria-label", `${task.title}目标数值`);
    const sync = (value: number, source: HTMLInputElement) => {
      task.current = clamp(Number(value) || 0, 0, Number(task.target));
      if (source !== range) range.value = String(task.current);
      if (source !== number) number.value = String(task.current);
      refreshVisual();
      this.plugin.persist();
    };
    const syncTarget = () => {
      const value = Number(targetNumber.value);
      if (!Number.isFinite(value) || value <= 0) return;
      task.target = value;
      task.current = clamp(Number(task.current) || 0, 0, task.target);
      range.max = String(task.target);
      range.step = String(taskStep(task));
      range.value = String(task.current);
      number.max = String(task.target);
      number.step = String(taskStep(task));
      number.value = String(task.current);
      refreshVisual();
      this.plugin.persist();
    };
    range.addEventListener("input", () => sync(Number(range.value), range));
    number.addEventListener("focus", () => number.select());
    number.addEventListener("input", () => sync(Number(number.value), number));
    targetNumber.addEventListener("focus", () => targetNumber.select());
    targetNumber.addEventListener("input", syncTarget);
    const values = el("div", "pd-direct-values");
    values.append(number, el("span", "", "/"), targetNumber, el("small", "", task.unit || ""));
    controls.append(range, values);
    card.append(controls);
    parent.append(card);
  }

  renderRoadmaps(parent: HTMLElement) {
    this.sectionHeading(parent, "LEARNING PATH", "学习路线", "新建", () => new RoadmapModal(this.app, this.plugin).open());
    const list = el("div", "pd-roadmap-list");
    if (!this.plugin.data.roadmaps.length) list.append(this.empty("还没有学习路线", "使用 → 建立阶段，使用 + 建立并行分支", () => new RoadmapModal(this.app, this.plugin).open()));
    this.plugin.data.roadmaps.forEach((roadmap: any) => list.append(this.roadmapCard(roadmap)));
    parent.append(list);
  }

  roadmapCard(roadmap: any) {
    const card = el("article", "pd-roadmap-card");
    const complete = roadmap.steps.filter((step: any) => step.done).length;
    const progress = roadmap.steps.length ? Math.round(complete / roadmap.steps.length * 100) : 0;
    const top = el("div", "pd-roadmap-top");
    const copy = el("div");
    copy.append(el("span", "", "LEARNING ROADMAP"), el("h3", "", roadmap.title));
    top.append(copy, el("strong", "", `${progress}%`), button("•••", "pd-more", () => new RoadmapModal(this.app, this.plugin, roadmap).open()));
    const track = el("div", "pd-track pd-roadmap-track");
    const fill = el("i");
    fill.style.width = `${progress}%`;
    track.append(fill);
    const meta = el("div", "pd-roadmap-meta");
    meta.append(el("span", "", `${complete} / ${roadmap.steps.length} 个节点完成`), el("b", "", "同阶段可并行"));
    const stages = el("div", "pd-roadmap-stages");
    groupRoadmap(roadmap).forEach((stage: any[], stageIndex: number) => {
      const stageEl = el("section", "pd-roadmap-stage");
      const label = el("div", "pd-stage-label");
      label.append(el("span", "", `阶段 ${stageIndex + 1}`));
      if (stage.length > 1) label.append(el("b", "", `${stage.length} 个并行分支`));
      const branches = el("div", "pd-branches");
      stage.forEach((step: any) => {
        const item = button("", step.done ? "is-done" : "", () => {
          step.done = !step.done;
          this.plugin.persistAndRender();
        });
        item.setAttribute("aria-pressed", String(step.done));
        item.append(el("span", "", step.done ? "✓" : "○"), el("strong", "", step.title), el("small", "", step.done ? "已学完" : "待学习"));
        branches.append(item);
      });
      stageEl.append(label, branches);
      stages.append(stageEl);
    });
    card.append(top, track, meta, stages);
    return card;
  }

  renderDeadlines(parent: HTMLElement) {
    const heading = this.sectionHeading(parent, "DEADLINE", "DDL 管理", "添加", () => new DeadlineModal(this.app, this.plugin).open());
    const switcher = el("div", "pd-switcher");
    [["calendar", "月历"], ["countdown", "倒计时"]].forEach(([mode, label]) => switcher.append(button(label, this.deadlineMode === mode ? "is-active" : "", () => { this.deadlineMode = mode; this.render(); })));
    heading.after(switcher);
    if (this.deadlineMode === "countdown") {
      const list = el("div", "pd-deadline-list");
      const deadlines = this.sortedDeadlines();
      if (deadlines.length) deadlines.forEach((item: any) => list.append(this.deadlineRow(item, true)));
      else list.append(this.empty("还没有 DDL", "添加日期后会自动显示倒计时", () => new DeadlineModal(this.app, this.plugin).open()));
      parent.append(list);
    } else this.renderCalendar(parent);
  }

  renderCalendar(parent: HTMLElement) {
    const card = el("section", "pd-calendar");
    const header = el("header");
    const title = el("strong", "", `${this.calendarCursor.getFullYear()} 年 ${this.calendarCursor.getMonth() + 1} 月`);
    const actions = el("div");
    actions.append(button("‹", "", () => { this.calendarCursor = new Date(this.calendarCursor.getFullYear(), this.calendarCursor.getMonth() - 1, 1); this.render(); }), button("今天", "", () => { this.calendarCursor = new Date(); this.render(); }), button("›", "", () => { this.calendarCursor = new Date(this.calendarCursor.getFullYear(), this.calendarCursor.getMonth() + 1, 1); this.render(); }));
    header.append(title, actions);
    card.append(header);
    const weekdays = el("div", "pd-calendar-weekdays");
    ["一", "二", "三", "四", "五", "六", "日"].forEach((day) => weekdays.append(el("span", "", day)));
    card.append(weekdays, this.calendarGrid(this.calendarCursor, this.plugin.data.deadlines, true));
    parent.append(card);
  }

  calendarGrid(focus: Date, deadlines: any[], showTitle = false) {
    const first = new Date(focus.getFullYear(), focus.getMonth(), 1);
    const start = new Date(first);
    start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    const grid = el("div", "pd-calendar-grid");
    for (let index = 0; index < 42; index++) {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const events = deadlines.filter((item: any) => dateKey(item.date) === dateKey(date));
      const cell = el("div", date.getMonth() === focus.getMonth() ? "" : "is-outside");
      if (dateKey(date) === dateKey(new Date())) cell.classList.add("is-today");
      if (events.length) {
        cell.classList.add("has-events");
        cell.style.setProperty("--pd-event-color", events[0].color || COLORS[0]);
        cell.setAttribute("aria-label", `${date.getDate()} 日，${events.length} 个 DDL：${events.map((item: any) => item.title).join("、")}`);
      }
      cell.append(el("span", "", String(date.getDate())));
      const dots = el("i");
      events.slice(0, 3).forEach((item: any) => { const dot = el("b"); dot.style.background = item.color; dots.append(dot); });
      cell.append(dots);
      if (events.length > 1) cell.append(el("em", "pd-event-count", String(events.length)));
      if (showTitle && events[0]) cell.append(el("small", "", events[0].title));
      grid.append(cell);
    }
    return grid;
  }

  buildMiniCalendar(deadlines: any[]) {
    const upcoming = deadlines.find((item: any) => new Date(item.date).getTime() >= Date.now());
    const focus = upcoming ? new Date(upcoming.date) : new Date();
    const popover = el("div", "pd-mini-calendar");
    const top = el("div", "pd-mini-top");
    top.append(el("div", "", `${focus.getFullYear()} 年 ${focus.getMonth() + 1} 月`), el("b", "", `全部 ${deadlines.length} 项`));
    const weekdays = el("div", "pd-calendar-weekdays");
    ["一", "二", "三", "四", "五", "六", "日"].forEach((day) => weekdays.append(el("span", "", day)));
    popover.append(top, weekdays, this.calendarGrid(focus, deadlines));
    const agenda = el("div", "pd-mini-agenda");
    deadlines.slice(0, 5).forEach((item: any) => {
      const row = el("div");
      const dot = el("i");
      dot.style.background = item.color;
      row.append(dot, el("strong", "", item.title), el("span", "", new Date(item.date).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })));
      agenda.append(row);
    });
    if (deadlines.length > 5) agenda.append(el("small", "", `还有 ${deadlines.length - 5} 项，请打开 DDL 页面查看`));
    popover.append(agenda);
    return popover;
  }

  deadlineRow(item: any, editable = false) {
    const remaining = countdown(item.date);
    const row = button("", `pd-deadline-row ${remaining.urgent ? "is-urgent" : ""} ${remaining.overdue ? "is-overdue" : ""}`, () => editable && new DeadlineModal(this.app, this.plugin, item).open());
    const date = new Date(item.date);
    const tile = el("span", "pd-date-tile");
    tile.style.color = item.color;
    tile.append(el("b", "", String(date.getDate())), el("small", "", date.toLocaleDateString("zh-CN", { month: "short" })));
    const copy = el("span", "pd-deadline-copy");
    copy.append(el("small", "", item.category || "未分类"), el("strong", "", item.title), el("em", "", formatDeadline(item.date)));
    row.append(tile, copy, el("b", "pd-countdown", remaining.text));
    if (!editable) row.classList.add("is-preview");
    return row;
  }

  sortedDeadlines() {
    return this.plugin.data.deadlines.slice().sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  empty(title: string, description: string, action: () => void) {
    const state = el("div", "pd-empty");
    state.append(el("span", "", "◇"), el("strong", "", title), el("p", "", description), button("添加", "pd-primary", action));
    return state;
  }
}

class ProgressDockSettingTab extends PluginSettingTab {
  plugin: any;

  constructor(app: any, plugin: any) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("启动时打开进度舱").setDesc("Obsidian 布局加载完成后，在右侧边栏打开进度舱。").addToggle((toggle: any) => toggle.setValue(this.plugin.data.settings.openOnStartup).onChange(async (value: boolean) => {
      this.plugin.data.settings.openOnStartup = value;
      await this.plugin.persist();
    }));
    new Setting(containerEl).setName("默认页面").setDesc("每次新打开进度舱时显示的页面。 ").addDropdown((dropdown: any) => dropdown.addOptions({ overview: "总览", tasks: "任务进度", roadmaps: "学习路线", deadlines: "DDL" }).setValue(this.plugin.data.settings.defaultTab).onChange(async (value: string) => {
      this.plugin.data.settings.defaultTab = value;
      await this.plugin.persist();
    }));
  }
}

class ProgressDockPlugin extends ObsidianPlugin {
  data: any;

  async onload() {
    const saved = await this.loadData();
    this.data = {
      ...DEFAULT_DATA,
      ...(saved || {}),
      tasks: saved?.tasks || [],
      deadlines: saved?.deadlines || [],
      roadmaps: saved?.roadmaps || [],
      settings: { ...DEFAULT_DATA.settings, ...(saved?.settings || {}) },
    };
    this.registerView(VIEW_TYPE, (leaf: any) => new ProgressDockView(leaf, this));
    this.addRibbonIcon("gauge", "打开进度舱", () => this.activateView());
    this.addCommand({ id: "open-progress-dock", name: "打开进度舱", callback: () => this.activateView() });
    this.addCommand({ id: "add-progress-task", name: "添加进度任务", callback: () => new TaskModal(this.app, this).open() });
    this.addCommand({ id: "add-deadline", name: "添加 DDL", callback: () => new DeadlineModal(this.app, this).open() });
    this.addCommand({ id: "add-learning-roadmap", name: "添加学习路线", callback: () => new RoadmapModal(this.app, this).open() });
    this.addSettingTab(new ProgressDockSettingTab(this.app, this));
    this.app.workspace.onLayoutReady(() => {
      if (this.data.settings.openOnStartup) this.activateView(false);
    });
  }

  async activateView(reveal = true) {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    if (reveal) this.app.workspace.revealLeaf(leaf);
  }

  async persist() {
    await this.saveData(this.data);
  }

  async persistAndRender() {
    await this.persist();
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf: any) => leaf.view.render());
  }
}

module.exports = ProgressDockPlugin;

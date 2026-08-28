/**
 * Saber Studio console strings, Chinese first (the design doc is written in
 * Chinese) with an English mirror. Layouts must tolerate ~30% text expansion
 * in either direction, so no component depends on a fixed string width.
 * Missing keys fall back to English, then to the key itself.
 */

export interface UiStrings {
  readonly zh: string;
  readonly en: string;
}

export const UI_STRINGS: Record<string, UiStrings> = {
  // Shell
  "app.title": { zh: "Saber Studio", en: "Saber Studio" },
  "app.console": {
    zh: "本地控制台 · 监督面",
    en: "Local console · supervisor surface",
  },
  "app.honestNote": {
    zh: "这是绑定 127.0.0.1 的本地监督控制台：每个动作都经过受治理的核心（默认拒绝策略、一次性审批、OS 沙箱、加密哈希链审计）。它不是设计文档中的完整桌面 IDE。",
    en: "This is a loopback-only local supervisor console: every action goes through the governed core (default-deny policy, one-shot approval, OS sandbox, encrypted hash-chained audit). It is not the full desktop IDE from the design doc.",
  },
  "nav.group.workspace": { zh: "工作面", en: "Workspaces" },
  "nav.group.systems": { zh: "能力与治理", en: "Capabilities & governance" },
  "nav.today": { zh: "今日", en: "Today" },
  "nav.goal": { zh: "目标与计划", en: "Goal & Plan" },
  "nav.conversation": { zh: "会话", en: "Conversation" },
  "nav.changes": { zh: "变更与审查", en: "Changes & Review" },
  "nav.runtime": { zh: "运行与时线", en: "Runtime & Timeline" },
  "nav.memory": { zh: "记忆与知识", en: "Memory & Knowledge" },
  "nav.armor": { zh: "装甲库", en: "Armor Rack" },
  "nav.evolution": { zh: "进化工坊", en: "Evolution Workshop" },
  "nav.health": { zh: "健康中心", en: "Health Center" },
  "nav.governance": { zh: "治理与设置", en: "Governance" },

  // Title bar
  "titlebar.workspace": { zh: "工作区", en: "Workspace" },
  "titlebar.branch": { zh: "分支", en: "Branch" },
  "titlebar.realm": { zh: "领域", en: "Realm" },
  "titlebar.realm.value": { zh: "local（本机受治理）", en: "local (governed)" },
  "titlebar.privacy": { zh: "隐私", en: "Privacy" },
  "titlebar.privacy.value": { zh: "仅本地 · 无外发", en: "Local only · no egress" },
  "titlebar.autonomy": { zh: "自治", en: "Autonomy" },
  "titlebar.autonomy.ask": { zh: "逐次审批", en: "Ask each time" },
  "titlebar.autonomy.deny": { zh: "只读（安全模式）", en: "Read-only (safe mode)" },
  "titlebar.health": { zh: "健康", en: "Health" },
  "titlebar.health.healthy": { zh: "H0 健康", en: "H0 healthy" },
  "titlebar.health.watching": { zh: "H1 关注", en: "H1 watching" },
  "titlebar.health.contained": { zh: "H2 已隔离", en: "H2 contained" },
  "titlebar.langToggle": { zh: "切换到 English", en: "切换到中文" },
  "titlebar.themeToggle": { zh: "切换浅色主题", en: "Switch to dark theme" },

  // Vital bar
  "vital.run": { zh: "运行", en: "Run" },
  "vital.approval": { zh: "待审批", en: "Approval" },
  "vital.realm": { zh: "领域", en: "Realm" },
  "vital.network": { zh: "网络", en: "Network" },
  "vital.network.deny": { zh: "默认拒绝", en: "deny by default" },
  "vital.policy": { zh: "策略", en: "Policy" },
  "vital.policy.value": { zh: "default-deny · 一次性审批", en: "default-deny · one-shot approval" },
  "vital.sandbox": { zh: "沙箱", en: "Sandbox" },
  "vital.cost": { zh: "成本", en: "Cost" },
  "vital.cost.value": { zh: "¥0 · 本地核心", en: "¥0 · local core" },
  "vital.offline": { zh: "控制台离线", en: "Console offline" },
  "vital.online": { zh: "控制台在线", en: "Console online" },

  // Common
  "common.close": { zh: "关闭", en: "Close" },
  "common.copy": { zh: "复制", en: "Copy" },
  "common.copied": { zh: "已复制", en: "Copied" },
  "common.empty": { zh: "暂无内容", en: "Nothing here yet" },
  "common.retry": { zh: "重试", en: "Retry" },
  "common.loading": { zh: "加载中…", en: "Loading…" },
  "common.never": { zh: "从未", en: "never" },
  "common.sessionOnly": {
    zh: "仅本控制台进程会话",
    en: "This console process session only",
  },
  "common.localOnly": { zh: "仅本地", en: "Local only" },

  // Today
  "today.title": { zh: "今日 · 指挥中心", en: "Today · Command Center" },
  "today.question": {
    zh: "什么在运行、什么需要我、什么失败、下一步是什么。",
    en: "What is running, what needs me, what failed, what is next.",
  },
  "today.continue": { zh: "继续", en: "Continue" },
  "today.continue.none": {
    zh: "还没有可继续的运行。在会话页发起第一次受治理的运行。",
    en: "No run to continue yet. Start the first governed run on the Conversation page.",
  },
  "today.continue.source": { zh: "来源", en: "Source" },
  "today.continue.verified": { zh: "最后验证", en: "Last verification" },
  "today.active": { zh: "活动运行", en: "Active runs" },
  "today.active.none": { zh: "没有等待中的运行。", en: "No runs waiting." },
  "today.inbox": { zh: "证据收件箱", en: "Evidence inbox" },
  "today.inbox.none": { zh: "没有等待你的事项。", en: "Nothing waiting for you." },
  "today.brief": { zh: "今日简报", en: "Today brief" },
  "today.brief.runs": { zh: "本会话运行", en: "Session runs" },
  "today.brief.executed": { zh: "已执行", en: "Executed" },
  "today.brief.denied": { zh: "被策略阻止", en: "Stopped by policy" },
  "today.brief.recovery": { zh: "最近恢复点", en: "Latest recovery point" },
  "today.brief.device": { zh: "设备", en: "Device" },

  // Goal & Plan
  "goal.title": { zh: "目标与计划", en: "Goal & Plan" },
  "goal.note": {
    zh: "目标不是聊天标题：验收、约束、预算与计划都是可治理对象。本页为本地草稿，随运行证据一起展示。",
    en: "A goal is not a chat title: acceptance, constraints, budget and plan are governed objects. This page holds a local draft shown alongside run evidence.",
  },
  "goal.objective": { zh: "目标", en: "Objective" },
  "goal.objective.ph": { zh: "用一句话说明要达成什么", en: "State the outcome in one sentence" },
  "goal.acceptance": { zh: "验收标准", en: "Acceptance criteria" },
  "goal.acceptance.ph": { zh: "可验证的验收条目", en: "A verifiable acceptance item" },
  "goal.acceptance.add": { zh: "添加验收条目", en: "Add criterion" },
  "goal.constraints": { zh: "约束", en: "Constraints" },
  "goal.constraints.ph": { zh: "例如：不修改 Policy/Sandbox 边界", en: "e.g. never weaken Policy/Sandbox boundaries" },
  "goal.budget": { zh: "预算", en: "Budget" },
  "goal.save": { zh: "保存目标", en: "Save goal" },
  "goal.saved": { zh: "目标已保存", en: "Goal saved" },
  "goal.plan": { zh: "任务计划", en: "Task plan" },
  "goal.plan.add": { zh: "添加任务", en: "Add task" },
  "goal.plan.ph": { zh: "可验证的任务", en: "A verifiable task" },
  "goal.plan.empty": { zh: "还没有任务。", en: "No tasks yet." },
  "goal.plan.timeline": { zh: "计划时间线", en: "Plan timeline" },
  "goal.plan.timeline.note": {
    zh: "本地草稿版本 1；尚未接入计划版本 Diff 与 Agent 提议流。",
    en: "Local draft v1; plan-version diffs and agent replanning are not wired yet.",
  },
  "goal.start": { zh: "开始实施（转到会话）", en: "Start implementation (open Conversation)" },

  // Conversation
  "conv.title": { zh: "会话", en: "Conversation" },
  "conv.note": {
    zh: "对话是协作视图；证据、审批与裁决来自核心的事件账本。本页每次提交就是一次真实的受治理运行。",
    en: "Conversation is a collaboration view; evidence, approvals and verdicts come from the core event ledger. Every submit here is one real governed run.",
  },
  "conv.empty": {
    zh: "输入一条命令发起首次运行。无放行许可时策略会拒绝它——那正是审批卡的来源。",
    en: "Submit a command to start the first run. Without a permit the policy denies it — that is where the Approval Card comes from.",
  },
  "conv.command": { zh: "命令（识别引号）", en: "Command (quote-aware)" },
  "conv.command.ph": { zh: "例如 /bin/sh -c 'echo hello'", en: "e.g. /bin/sh -c 'echo hello'" },
  "conv.allow": { zh: "放行程序名（逗号分隔）", en: "Permitted program names (comma-separated)" },
  "conv.approve": {
    zh: "我批准这个确切请求（一次性）",
    en: "I approve this exact request (one-shot)",
  },
  "conv.run": { zh: "在策略下运行", en: "Run under policy" },
  "conv.running": { zh: "核心裁决中…", en: "Core is deciding…" },
  "conv.nutrition": { zh: "上下文营养标签", en: "Context nutrition label" },
  "conv.nutrition.dest": { zh: "目的地", en: "Destination" },
  "conv.nutrition.dest.value": { zh: "本地核心进程（不出本机）", en: "local core process (never leaves this machine)" },
  "conv.nutrition.sensitivity": { zh: "敏感度", en: "Sensitivity" },
  "conv.nutrition.chars": { zh: "命令字符", en: "Command chars" },
  "conv.nutrition.redacted": { zh: "脱敏字段", en: "Redacted fields" },
  "conv.nutrition.excluded": { zh: "排除来源", en: "Excluded sources" },
  "conv.nutrition.freshness": { zh: "新鲜度警告", en: "Freshness warnings" },
  "conv.msg.user": { zh: "用户命令", en: "User command" },
  "conv.verdict.executed": { zh: "已执行", en: "Executed" },
  "conv.verdict.denied": { zh: "被策略拒绝", en: "Denied by policy" },
  "conv.verdict.failed": { zh: "效果失败", en: "Effect failed" },
  "conv.verdict.unparsed": { zh: "已结束", en: "Finished" },

  // Approval Card
  "approval.title": { zh: "审批请求", en: "Approval request" },
  "approval.verb": { zh: "在沙箱内执行 1 条命令", en: "Execute 1 command inside the sandbox" },
  "approval.risk": { zh: "风险：进程生成（受沙箱与审计约束）", en: "Risk: process spawn (sandboxed and audited)" },
  "approval.resources": { zh: "确切资源", en: "Exact resources" },
  "approval.why": { zh: "为什么需要", en: "Why it is needed" },
  "approval.why.none": {
    zh: "会话中未设置目标；可在目标页补充。",
    en: "No goal is set for this session; add one on the Goal page.",
  },
  "approval.boundaries": { zh: "边界", en: "Boundaries" },
  "approval.sandbox": { zh: "沙箱：OS 档案强制启用", en: "Sandbox: OS profile enforced" },
  "approval.egress": { zh: "网络：默认拒绝", en: "Network: denied by default" },
  "approval.audit": { zh: "审计：加密哈希链", en: "Audit: encrypted hash chain" },
  "approval.reversibility": {
    zh: "可逆性：命令输出不可撤销，但范围仅限本次运行",
    en: "Reversibility: output cannot be undone, but scope is this run only",
  },
  "approval.scope": {
    zh: "范围与期限：仅此一次 · 卡片 5 分钟后过期",
    en: "Scope & TTL: once only · card expires in 5 minutes",
  },
  "approval.deny": { zh: "拒绝", en: "Deny" },
  "approval.allowOnce": { zh: "允许一次", en: "Allow once" },
  "approval.narrow": { zh: "收窄范围…", en: "Narrow scope…" },
  "approval.narrow.run": { zh: "按收窄范围运行", en: "Run with narrowed scope" },
  "approval.narrow.ph": { zh: "程序名，逗号分隔", en: "program names, comma-separated" },
  "approval.expired": { zh: "已过期", en: "Expired" },
  "approval.decided.deny": { zh: "已拒绝", en: "Denied" },
  "approval.decided.allow": { zh: "已允许（一次性）", en: "Allowed (once)" },
  "approval.queue": { zh: "审批队列", en: "Approval queue" },

  // Evidence Receipt
  "receipt.title": { zh: "证据收据", en: "Evidence receipt" },
  "receipt.runId": { zh: "运行", en: "Run" },
  "receipt.verdict": { zh: "裁决", en: "Verdict" },
  "receipt.exit": { zh: "退出码", en: "Exit code" },
  "receipt.events": { zh: "事件数", en: "Events" },
  "receipt.hash": { zh: "哈希链", en: "Hash chain" },
  "receipt.verified": { zh: "已验证", en: "Verified" },
  "receipt.unverified": { zh: "未验证", en: "Unverified" },
  "receipt.duration": { zh: "耗时", en: "Duration" },
  "receipt.stdout": { zh: "命令输出", en: "Command output" },
  "receipt.digest": { zh: "输出摘要 (SHA-256)", en: "Output digest (SHA-256)" },
  "receipt.digest.pending": { zh: "计算中…", en: "Computing…" },
  "receipt.store": { zh: "审计库", en: "Audit store" },
  "receipt.open": { zh: "收据", en: "Receipt" },

  // Changes & Review
  "changes.title": { zh: "变更与审查", en: "Changes & Review" },
  "changes.note": {
    zh: "渲染器无 Git/Shell 直连（设计 §12）：变更以“运行证据”呈现。每个已执行运行都是一次变更尝试，审查结论与证据绑定。",
    en: "The renderer has no direct Git/Shell access (design §12): changes are presented as run evidence. Every executed run is a change attempt, and review decisions bind to evidence.",
  },
  "changes.empty": { zh: "还没有已执行的运行。", en: "No executed runs yet." },
  "changes.ladder": { zh: "证据阶梯", en: "Evidence ladder" },
  "changes.ladder.intent": { zh: "意图", en: "Intent" },
  "changes.ladder.policy": { zh: "策略裁决", en: "Policy decision" },
  "changes.ladder.effect": { zh: "沙箱内效果", en: "Sandboxed effect" },
  "changes.ladder.verification": { zh: "验证", en: "Verification" },
  "changes.review.accept": { zh: "接受", en: "Accept" },
  "changes.review.reject": { zh: "拒绝", en: "Reject" },
  "changes.review.accepted": { zh: "审查通过", en: "Review accepted" },
  "changes.review.rejected": { zh: "审查拒绝", en: "Review rejected" },
  "changes.review.pending": { zh: "待审查", en: "Awaiting review" },

  // Runtime & Timeline
  "runtime.title": { zh: "运行与时线", en: "Runtime & Timeline" },
  "runtime.timeline": { zh: "事件时间线", en: "Event timeline" },
  "runtime.filter.all": { zh: "全部", en: "All" },
  "runtime.filter.executed": { zh: "已执行", en: "Executed" },
  "runtime.filter.denied": { zh: "已拒绝", en: "Denied" },
  "runtime.filter.waiting": { zh: "等待人", en: "Waiting user" },
  "runtime.empty": { zh: "本会话还没有事件。", en: "No events this session yet." },
  "runtime.agentmap": { zh: "Agent 图", en: "Agent map" },
  "runtime.agent.core": { zh: "受治理核心（唯一执行主体）", en: "Governed core (the only executor)" },
  "runtime.agent.waiting": { zh: "等待原因", en: "Waiting reason" },
  "runtime.agent.waiting.none": { zh: "无", en: "None" },
  "runtime.agent.waiting.approval": { zh: "等待人工审批", en: "Waiting for human approval" },

  // Memory & Knowledge
  "memory.title": { zh: "记忆与知识", en: "Memory & Knowledge" },
  "memory.note": {
    zh: "记忆可浏览、可拒绝、可撤销——没有不可见的自动记忆。本页记忆仅存于本机浏览器存储，绝不外发。",
    en: "Memory is browsable, rejectable and revocable — no invisible automatic memory. Entries live only in this browser's local storage and are never sent anywhere.",
  },
  "memory.ledger": { zh: "记忆账本", en: "Memory ledger" },
  "memory.add": { zh: "添加记忆候选", en: "Add memory candidate" },
  "memory.titleField": { zh: "标题", en: "Title" },
  "memory.bodyField": { zh: "内容", en: "Body" },
  "memory.scope": { zh: "作用域", en: "Scope" },
  "memory.sensitivity": { zh: "敏感度", en: "Sensitivity" },
  "memory.state.candidate": { zh: "候选", en: "Candidate" },
  "memory.state.accepted": { zh: "已接受", en: "Accepted" },
  "memory.state.rejected": { zh: "已拒绝", en: "Rejected" },
  "memory.state.revoked": { zh: "已撤销", en: "Revoked" },
  "memory.accept": { zh: "接受", en: "Accept" },
  "memory.reject": { zh: "拒绝", en: "Reject" },
  "memory.revoke": { zh: "撤销", en: "Revoke" },
  "memory.attach": { zh: "附到上下文", en: "Attach to context" },
  "memory.detach": { zh: "移出上下文", en: "Detach from context" },
  "memory.usage": { zh: "上下文使用", en: "Context usage" },
  "memory.usage.none": { zh: "当前没有附加任何记忆。", en: "No memories attached to context." },
  "memory.provenance": { zh: "来源", en: "Provenance" },
  "memory.provenance.user": { zh: "人工录入", en: "Entered by user" },

  // Armor Rack
  "armor.title": { zh: "装甲库", en: "Armor Rack" },
  "armor.note": {
    zh: "外部装甲可卸载，内生能力可回滚；两者都不能修改宪法与信任根。",
    en: "External armor can be unloaded and internal capabilities rolled back; neither may touch the constitution or trust root.",
  },
  "armor.local": { zh: "本机装甲", en: "Local armor" },
  "armor.core": { zh: "受治理核心", en: "Governed core" },
  "armor.node": { zh: "控制台宿主", en: "Console host" },
  "armor.sandbox": { zh: "OS 沙箱后端", en: "OS sandbox backend" },
  "armor.models": { zh: "模型 Provider", en: "Model providers" },
  "armor.mcp": { zh: "MCP / 连接器", en: "MCP / connectors" },
  "armor.plugins": { zh: "插件", en: "Plugins" },
  "armor.empty": {
    zh: "未配置任何外部项。本控制台完全离线运行——这是诚实的空状态，不是故障。",
    en: "Nothing external is configured. This console runs fully offline — an honest empty state, not a fault.",
  },
  "armor.trust": { zh: "信任", en: "Trust" },
  "armor.trust.verified": { zh: "已验证（本机存在且可执行）", en: "Verified (present and executable locally)" },
  "armor.dataBoundary": { zh: "数据边界", en: "Data boundary" },
  "armor.dataBoundary.loopback": { zh: "仅 127.0.0.1", en: "127.0.0.1 loopback only" },

  // Evolution Workshop
  "evo.title": { zh: "进化工坊", en: "Evolution Workshop" },
  "evo.note": {
    zh: "像 Code Review 一样审查系统“想学什么”。候选生命周期沿用核心进化舱室：Proposed → Quarantined → Evaluated → Promoted / Rejected / Revoked；运行中的 Agent 不能自批 E6，E7 信任根不可修改。",
    en: "Review what the system “wants to learn” like code review. Candidates follow the core workshop lifecycle: Proposed → Quarantined → Evaluated → Promoted / Rejected / Revoked; a running agent may never self-approve E6, and the E7 trust root is immutable.",
  },
  "evo.ladder": { zh: "治理阶梯 E0–E7", en: "Governance ladder E0–E7" },
  "evo.candidates": { zh: "候选（来自记忆账本）", en: "Candidates (from the memory ledger)" },
  "evo.empty": { zh: "还没有候选。在记忆页添加。", en: "No candidates yet. Add one on the Memory page." },
  "evo.level.E0": { zh: "E0 观察", en: "E0 Observed" },
  "evo.level.E1": { zh: "E1 个人记忆", en: "E1 Personal memory" },
  "evo.level.E2": { zh: "E2 个人技能/工作流", en: "E2 Personal skill/workflow" },
  "evo.level.E3": { zh: "E3 团队共享（需评审）", en: "E3 Team sharing (review required)" },
  "evo.level.E4": { zh: "E4 组织规则（签名）", en: "E4 Org rule (signed)" },
  "evo.level.E5": { zh: "E5 代码胶囊", en: "E5 Code capsule" },
  "evo.level.E6": { zh: "E6 核心变更（禁自批）", en: "E6 Core change (no self-approval)" },
  "evo.level.E7": { zh: "E7 信任根（不可变）", en: "E7 Trust root (immutable)" },
  "evo.level.current": { zh: "当前最高达成级别", en: "Highest achieved level" },

  // Health Center
  "health.title": { zh: "健康中心", en: "Health Center" },
  "health.vital": { zh: "Trust Cell 生命体征", en: "Trust Cell vital" },
  "health.incidents": { zh: "事件时间线", en: "Incident timeline" },
  "health.incidents.none": { zh: "本会话没有事件。", en: "No incidents this session." },
  "health.incident.denied": {
    zh: "策略阻止了一条未授权命令（检测 → 止损：默认拒绝即止血）",
    en: "Policy stopped an unauthorized command (detect → contain: default-deny is the tourniquet)",
  },
  "health.incident.expired": {
    zh: "一张审批卡过期失效（防 TOCTOU：过期即不可点击）",
    en: "An approval card expired (anti-TOCTOU: expired cards are not clickable)",
  },
  "health.phase.detect": { zh: "检测", en: "Detect" },
  "health.phase.contain": { zh: "止损", en: "Contain" },
  "health.auto": { zh: "自动处置", en: "Automatic actions" },
  "health.auto.none": { zh: "还没有需要自动处置的事件。", en: "No automatic action needed yet." },
  "health.recovery": { zh: "恢复控制", en: "Recovery controls" },
  "health.safemode": {
    zh: "安全模式：所有新运行都不带审批提交，由策略默认拒绝并留痕。",
    en: "Safe mode: every new run is submitted without approval, policy-denied by default and recorded.",
  },
  "health.safemode.on": { zh: "进入安全模式", en: "Enter safe mode" },
  "health.safemode.off": { zh: "退出安全模式", en: "Exit safe mode" },
  "health.export": { zh: "导出支持包（会话状态 JSON）", en: "Export support bundle (session state JSON)" },

  // Governance
  "gov.title": { zh: "治理与设置", en: "Governance & settings" },
  "gov.policy": { zh: "策略事实", en: "Policy facts" },
  "gov.policy.defaultdeny": {
    zh: "默认拒绝：无许可的命令一律被拒（本会话有真实拒收据为证）",
    en: "Default deny: commands without a permit are always refused (real denial receipts this session prove it)",
  },
  "gov.policy.oneshot": {
    zh: "一次性审批：每次放行只作用于一次确切请求，无“永远允许”",
    en: "One-shot approval: each grant covers exactly one request; no “always allow”",
  },
  "gov.policy.sandbox": {
    zh: "沙箱强制：进程生成必须经过 OS 沙箱档案",
    en: "Mandatory sandbox: process spawns must go through the OS sandbox profile",
  },
  "gov.policy.audit": {
    zh: "加密审计：事件写入 SQLCipher 加密库并验证哈希链",
    en: "Encrypted audit: events go to a SQLCipher-encrypted store with a verified hash chain",
  },
  "gov.approvallog": { zh: "审批日志", en: "Approval log" },
  "gov.approvallog.empty": { zh: "还没有审批决策。", en: "No approval decisions yet." },
  "gov.settings": { zh: "设置", en: "Settings" },
  "gov.lang": { zh: "语言 / Language", en: "Language / 语言" },
  "gov.theme": { zh: "主题", en: "Theme" },
  "gov.theme.dark": { zh: "深色", en: "Dark" },
  "gov.theme.light": { zh: "浅色", en: "Light" },
  "gov.density": { zh: "密度", en: "Density" },
  "gov.density.compact": { zh: "紧凑", en: "Compact" },
  "gov.density.comfortable": { zh: "舒适", en: "Comfortable" },
  "gov.philosophy": { zh: "哲学解释层", en: "Philosophy layer" },
  "gov.philosophy.note": {
    zh: "在关键组件旁显示“免疫、装甲、脊柱”等隐喻解释；默认使用专业术语。",
    en: "Shows metaphor explanations (immune system, armor, spine) next to key components; professional terms stay primary.",
  },
  "gov.keys": { zh: "键盘", en: "Keyboard" },
  "gov.keys.note": {
    zh: "⌘/Ctrl+1..5 切换工作面 · ⌘/Ctrl+K 命令面板 · ⌘/Ctrl+Shift+A 审批队列 · Esc 关闭浮层",
    en: "⌘/Ctrl+1..5 switch workspaces · ⌘/Ctrl+K command palette · ⌘/Ctrl+Shift+A approval queue · Esc close overlays",
  },
  "gov.enterprise": { zh: "企业模块", en: "Enterprise modules" },
  "gov.enterprise.note": {
    zh: "SSO/SCIM、租户、KMS、Break Glass 等属于企业控制台范围，不在本地控制台内。隐藏按钮不等于存在授权控制。",
    en: "SSO/SCIM, tenants, KMS and Break Glass belong to the enterprise admin console, not this local console. A hidden button is not an authorization control.",
  },
  "gov.phil.spine": {
    zh: "脊柱：Goal→Task→Run→Evidence 的连续性线。",
    en: "Spine: the continuity line from Goal→Task→Run→Evidence.",
  },
  "gov.phil.cell": {
    zh: "细胞：每个工作区有边界、策略与健康。",
    en: "Cell: every workspace has a boundary, a policy and a health state.",
  },
  "gov.phil.vital": {
    zh: "生命体征：底部持续可见的运行与风险信号。",
    en: "Vitals: always-visible run and risk signals at the bottom.",
  },

  // Errors (four-part copy, design §9)
  "err.what": { zh: "发生了什么", en: "What happened" },
  "err.impact": { zh: "影响", en: "Impact" },
  "err.done": { zh: "系统已做什么", en: "What the system did" },
  "err.next": { zh: "你可以做什么", en: "What you can do" },
  "err.offline.what": { zh: "控制台服务不可达。", en: "The console server is unreachable." },
  "err.offline.impact": {
    zh: "页面保持只读；没有任何命令被执行。",
    en: "The page stays read-only; no command was executed.",
  },
  "err.offline.done": {
    zh: "生命体征栏已显示离线；本地草稿仍保存在浏览器中。",
    en: "The vital bar shows offline; local drafts remain saved in the browser.",
  },
  "err.offline.next": {
    zh: "重试连接，或用 bin/saber ui 重启控制台。",
    en: "Retry the connection, or restart the console with bin/saber ui.",
  },
  "err.spawn.what": { zh: "核心进程未能完成这次运行。", en: "The core process could not complete this run." },
  "err.spawn.impact": { zh: "该命令未产生任何效果。", en: "The command produced no effect." },
  "err.spawn.done": {
    zh: "失败已按原样记录在会话历史中。",
    en: "The failure is recorded verbatim in session history.",
  },
  "err.spawn.next": { zh: "检查核心二进制是否存在后重试。", en: "Check that the core binary exists, then retry." },

  // Palette
  "palette.ph": { zh: "输入命令或页面名…", en: "Type a command or page name…" },
  "palette.empty": { zh: "没有匹配项", en: "No matches" },
  "palette.open": { zh: "打开", en: "Open" },

  // Observable states (tokens state vocabulary)
  "state.initial": { zh: "初始", en: "Initial" },
  "state.loading": { zh: "加载中", en: "Loading" },
  "state.streaming": { zh: "裁决中", en: "Deciding" },
  "state.empty": { zh: "空", en: "Empty" },
  "state.partial": { zh: "部分", en: "Partial" },
  "state.verified": { zh: "已验证", en: "Verified" },
  "state.knowledge": { zh: "知识", en: "Knowledge" },
  "state.approval": { zh: "已审批", en: "Approval" },
  "state.incident": { zh: "事件", en: "Incident" },
  "state.waiting_user": { zh: "等待用户", en: "Waiting user" },
  "state.waiting_external": { zh: "等待外部", en: "Waiting external" },
  "state.offline": { zh: "离线", en: "Offline" },
  "state.permission_denied": { zh: "权限拒绝", en: "Permission denied" },
  "state.policy_denied": { zh: "策略拒绝", en: "Policy denied" },
  "state.degraded": { zh: "降级", en: "Degraded" },
  "state.contained": { zh: "已隔离", en: "Contained" },
  "state.stale": { zh: "过期", en: "Stale" },
  "state.conflict": { zh: "冲突", en: "Conflict" },
  "state.completed": { zh: "已完成", en: "Completed" },
  "state.archived": { zh: "已归档", en: "Archived" },

  // Live region announcements (design §11 accessibility)
  "live.approval": { zh: "新的审批请求等待你的决定。", en: "A new approval request is waiting for your decision." },
  "live.completed": { zh: "一次运行已完成。", en: "A run has completed." },
  "live.contained": { zh: "一次未授权命令已被策略隔离。", en: "An unauthorized command was contained by policy." },
};

/** Both-language dictionary used by tests to prove key parity. */
export function uiDictionary(): Record<string, UiStrings> {
  return UI_STRINGS;
}

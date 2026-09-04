// Agent Risk Guard plugin for OpenCode (v0.1.0 namespace: agent-risk-guard)
// Deterministic pre-execution safety - no LLM, no network, no subprocess
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import * as fs from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"

const HOME_RAW = (process.env.USERPROFILE || process.env.HOME || "").replace(/[\\\/]+$/, "")
const HOME_NORM = HOME_RAW.toLowerCase().replace(/\\/g, "/")
const CFG = path.join(HOME_RAW, ".config", "opencode")
const CFG_NORM = CFG.toLowerCase().replace(/\\/g, "/")
const PLUGDIR = path.join(CFG, "plugins")
const PLUGDIR_NORM = PLUGDIR.toLowerCase().replace(/\\/g, "/")
const PLUGFILE = path.join(PLUGDIR, "agent-risk-guard.ts")
const PLUGFILE_NORM = PLUGFILE.toLowerCase().replace(/\\/g, "/")
const LOGDIR = path.join(CFG, "logs")
const LOGFILE = path.join(LOGDIR, "agent-risk-guard.log")

const P = {
  PERMANENT_DELETE_POSIX: "PERMANENT_DELETE_POSIX",
  PERMANENT_DELETE_POWERSHELL: "PERMANENT_DELETE_POWERSHELL",
  PERMANENT_DELETE_CMD: "PERMANENT_DELETE_CMD",
  PERMANENT_DELETE_PYTHON: "PERMANENT_DELETE_PYTHON",
  PERMANENT_DELETE_NODE: "PERMANENT_DELETE_NODE",
  GIT_CLEAN_DESTRUCTIVE: "GIT_CLEAN_DESTRUCTIVE",
  GIT_RESET_HARD: "GIT_RESET_HARD",
  GIT_WORKTREE_DISCARD: "GIT_WORKTREE_DISCARD",
  DISK_FORMAT_WINDOWS: "DISK_FORMAT_WINDOWS",
  DISK_FORMAT_POSIX: "DISK_FORMAT_POSIX",
  DISK_WRITE_DEVICE: "DISK_WRITE_DEVICE",
  PROTECTED_PATH_DELETE: "PROTECTED_PATH_DELETE",
  PROTECTED_GUARD_MUTATION: "PROTECTED_GUARD_MUTATION",
  ENCODED_COMMAND_OBFUSCATION: "ENCODED_COMMAND_OBFUSCATION",
  UNPARSEABLE_DESTRUCTIVE: "UNPARSEABLE_DESTRUCTIVE",
  REMOTE_EXECUTION_PIPE: "REMOTE_EXECUTION_PIPE",
} as const

type PolicyId = (typeof P)[keyof typeof P]
// --- Logging ---
function ensureDir(d: string) { try { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }) } catch {} }
function redact(s: string): string {
  return s.replace(/(?:api[_-]?key|token|secret|password|credential|authorization)\s*[=:]\s*["']?\s*\S{4,}/gi, "$1=[REDACTED]")
    .replace(/(?:AKIA|ghp_|gho_|ghs_|ghr_|sk-|sk_live-|pk-|pk_live-|xoxb-|xoxp-|Bearer\s+)[A-Za-z0-9_\-]{16,}/g, "[REDACTED]")
}
function logBlock(e: { tool: string; policy: PolicyId; command: string; reason: string; sid?: string; wd?: string }) {
  try {
    ensureDir(LOGDIR)
    const ts = new Date().toISOString()
    const l = `ts=${ts} tool=${e.tool} session=${e.sid||"-"} workdir=${e.wd||"-"} policy=${e.policy} cmd=${redact(e.command.slice(0,400))} result=BLOCKED reason=${e.reason}`
    fs.appendFileSync(LOGFILE, l + "\n")
  } catch {}
}

// --- Path helpers ---
function norm(p: string): string { return p.toLowerCase().replace(/\\/g, "/").replace(/\/+$/, "") }
function expandTilde(p: string): string {
  if (p === "~" || p === "~/") return HOME_RAW
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(HOME_RAW, p.slice(2))
  if (p.startsWith("$HOME/") || p.startsWith("$HOME\\")) return path.join(HOME_RAW, p.slice(6))
  if (p.startsWith("%USERPROFILE%\\") || p.startsWith("%USERPROFILE%/")) return path.join(HOME_RAW, p.slice(16))
  return p
}
type PR = { hit: boolean; label: string }
function checkProtected(target: string): PR {
  const n = norm(expandTilde(target))
  if (n === PLUGFILE_NORM) return { hit: true, label: "Guard plugin file" }
  if (n === PLUGDIR_NORM || n.startsWith(PLUGDIR_NORM + "/")) return { hit: true, label: "OpenCode plugins dir" }
  if (n === CFG_NORM || n.startsWith(CFG_NORM + "/")) return { hit: true, label: "OpenCode config dir" }
  if (HOME_NORM && (n === HOME_NORM || n === HOME_NORM + "/")) return { hit: true, label: "User home directory" }
  for (const wp of ["c:/windows","c:/windows/system32","c:/windows/system","c:/program files","c:/program files (x86)"]) {
    if (n === wp || n.startsWith(wp + "/")) return { hit: true, label: "Windows protected: " + wp }
  }
  return { hit: false, label: "" }
}
// --- Quote-aware statement splitting ---
function splitTopLevel(line: string): string[] {
  const segs: string[] = []
  let cur = "", inS = false, inD = false, depth = 0, i = 0
  while (i < line.length) {
    const c = line[i]
    if (c === "'" && !inD) { inS = !inS; cur += c; i++; continue }
    if (c === '"' && !inS) { inD = !inD; cur += c; i++; continue }
    if (!inS && !inD) {
      if (c === "(") { depth++; cur += c; i++; continue }
      if (c === ")") { depth--; cur += c; i++; continue }
      if (depth === 0) {
        if (i + 1 < line.length) { const tw = c + line[i+1]; if (tw === "&&" || tw === "||") { segs.push(cur); cur = ""; i += 2; continue } }
        if (c === ";" || c === "|" || c === "&") { segs.push(cur); cur = ""; i++; continue }
      }
    }
    cur += c; i++
  }
  segs.push(cur)
  return segs
}
function splitStmts(cmd: string): string[] {
  const all: string[] = []
  for (const line of cmd.split(/\r?\n/)) all.push(...splitTopLevel(line))
  return all.map(s => s.trim()).filter(Boolean)
}

// --- Wrapper unwrapping ---
function unquote(s: string): string {
  const t = s.trim()
  if ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'"))) return t.slice(1, -1)
  return t
}
function unwrapWrapper(stmt: string): string | null {
  const t = stmt.trim()
  // PowerShell
  let m = t.match(/^(?:powershell|pwsh)(?:\.exe)?\s+/i)
  if (m) {
    const rest = t.slice(m[0].length), lo = rest.toLowerCase()
    for (const f of ["-encodedcommand","-ec"]) {
      const idx = lo.indexOf(f)
      if (idx !== -1) {
        // R16 修复（B-05）：编码命令无法安全验证 → 直接标记 __ENCODED__（全拦截，不解码）
        return `__ENCODED__${rest.slice(idx + f.length).trim().split(/\s/)[0] || ""}`
      }
    }
    for (const f of ["-command","-c"]) {
      const idx = lo.indexOf(f)
      if (idx !== -1) return unquote(rest.slice(idx + f.length).trimStart())
    }
  }
  // Invoke-Expression / iex
  m = t.match(/^(?:Invoke-Expression|iex)\s+/i)
  if (m) return unquote(t.slice(m[0].length))
  // cmd /c
  m = t.match(/^cmd(?:\.exe)?\s+\/c\s+/i)
  if (m) return t.slice(m[0].length).trim()
  // bash/sh -c —— R16 修复（B-04）：允许任意 flags 插在中间（bash --noprofile -c / bash -x -c / sh -p -c）
  m = t.match(/^(?:bash|sh|zsh|ksh|dash|git-bash)(?:\.exe)?(?:\s+--?[a-z][a-z0-9-]*)*?\s+-c\s+/i)
  if (m) return unquote(t.slice(m[0].length))
  // python -c
  m = t.match(/^(?:python[23]?|py)(?:\.exe)?\s+-c\s+/i)
  if (m) return unquote(t.slice(m[0].length))
  // node -e
  m = t.match(/^(?:node|nodejs)(?:\.exe)?\s+(?:--eval|-e)\s+/i)
  if (m) return unquote(t.slice(m[0].length))
  // R16 修复（B-06）：eval 包裹（bash/sh eval 'rm ...'）
  m = t.match(/^(?:eval)\s+/i)
  if (m) return unquote(t.slice(m[0].length))
  return null
}

// --- Segment expansion ---
function expandSegments(cmd: string): string[] {
  // R16 修复（对齐 ps1/core）：NFKC 归一化全角字符（ｒｍ → rm），防 Uncode 绕过
  const norm = cmd.normalize('NFKC')
  const stmts = splitStmts(norm), out: string[] = []
  for (const s of stmts) {
    let inner = s
    while (inner.startsWith("(") && inner.endsWith(")") && inner.length > 2) inner = inner.slice(1, -1).trim()
    for (const p of splitStmts(inner)) {
      const w = unwrapWrapper(p)
      if (w !== null) out.push(...expandSegments(w))
      else out.push(p.trim())
    }
    // R16 修复（B-02/B-03）：$() 与反引号命令替换内容也展开为独立段检查
    for (const sub of extractSubshells(inner)) out.push(...expandSegments(sub))
  }
  return out.filter(Boolean)
}

/** R16：提取 $(...) 与 `...` 命令替换内容 */
function extractSubshells(s: string): string[] {
  const out: string[] = []
  let depth = 0, start = -1
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '$' && s[i + 1] === '(') { if (depth === 0) start = i + 2; depth++; i++ } // 跳过紧随的 '('（防双重计数）
    else if (ch === '(') depth++
    else if (ch === ')') { depth--; if (depth === 0 && start !== -1) { out.push(s.slice(start, i)); start = -1 } }
    else if (ch === '`') {
      const e = s.indexOf('`', i + 1)
      if (e !== -1) { out.push(s.slice(i + 1, e)); i = e }
    }
  }
  return out
}
// --- Detectors ---
type Block = { policy: PolicyId; reason: string }

function detectPOSIX(s: string): Block | null {
  // R16 修复：空引号剥离（r''m → rm）+ 空格混淆归一（r   m → rm）（B-07/B-15）
  const norm = s.replace(/''/g, "").replace(/\s+/g, " ")
  const lo = norm.toLowerCase()
  // rm 帮助/版本无害（排除误拦）
  if (/^rm\s+(?:--help|-h|--version|-v)\b/.test(lo)) return null
  // rm
  if (/\brm\b/.test(lo) && !/\barm\b/.test(lo)) {
    // R16 补充（B-16）：变量赋值内容含 rm -rf（$x="rm -rf /tmp"）——展开后危险
    if (/=\s*["']\s*rm\s+-rf\b/.test(lo))
      return { policy: P.PERMANENT_DELETE_POSIX, reason: "Variable assignment contains rm -rf (dangerous on expansion)." }
    const first = lo.replace(/^\s*[&.{}]\s*/, "").trim()
    // R16 修复：段首/分隔符/{}/case 后（B-08）
    if (/^rm\b/.test(first) || /[;&|{}]\s*rm\b/.test(first) || /\|\s*rm\b/.test(first) || /case\b[^;]*\)\s*rm\b/.test(first))
      return { policy: P.PERMANENT_DELETE_POSIX, reason: "Permanent deletion via rm is disabled. Use the trash tool instead." }
  }
  // rmdir
  if (/^rmdir\b/.test(lo) || /[;&|{}]\s*rmdir\b/.test(lo))
    return { policy: P.PERMANENT_DELETE_POSIX, reason: "Permanent directory deletion via rmdir is disabled. Use the trash tool instead." }
  // unlink
  if (/^unlink\b/.test(lo) || /[;&|{}]\s*unlink\b/.test(lo))
    return { policy: P.PERMANENT_DELETE_POSIX, reason: "Permanent file deletion via unlink is disabled. Use the trash tool instead." }
  // shred
  if (/^shred\b/.test(lo) || /[;&|{}]\s*shred\b/.test(lo))
    return { policy: P.PERMANENT_DELETE_POSIX, reason: "Permanent file destruction via shred is disabled." }
  // find -delete / -exec rm
  if (/^(?:find)\b/.test(lo) && (/\b-delete\b/.test(lo) || /\b-exec\b.*\brm\b/.test(lo)))
    return { policy: P.PERMANENT_DELETE_POSIX, reason: "Permanent file deletion via find -delete/-exec rm is disabled." }
  // xargs rm
  if (/xargs\b.*\brm\b/.test(lo) || /xargs\b.*\brmdir\b/.test(lo))
    return { policy: P.PERMANENT_DELETE_POSIX, reason: "Permanent file deletion via xargs rm is disabled." }
  return null
}

function detectPowerShell(s: string): Block | null {
  const lo = s.toLowerCase()
  if (/^(?:remove-item|ri)\b/.test(lo) || /[;&|]\s*(?:remove-item|ri)\b/.test(lo))
    return { policy: P.PERMANENT_DELETE_POWERSHELL, reason: "Permanent deletion via Remove-Item is disabled. Use the trash tool instead." }
  if (/^(?:clear-content|clc)\b/.test(lo) || /[;&|]\s*(?:clear-content|clc)\b/.test(lo))
    return { policy: P.PERMANENT_DELETE_POWERSHELL, reason: "File content destruction via Clear-Content is disabled." }
  if (/\[(?:system\.)?io\.file\]::delete\b/.test(lo))
    return { policy: P.PERMANENT_DELETE_POWERSHELL, reason: "Permanent file deletion via .NET File.Delete is disabled." }
  if (/\[(?:system\.)?io\.directory\]::delete\b/.test(lo))
    return { policy: P.PERMANENT_DELETE_POWERSHELL, reason: "Permanent directory deletion via .NET Directory.Delete is disabled." }
  return null
}

function detectCMD(s: string): Block | null {
  const lo = s.toLowerCase()
  if (/^(?:del|erase)\b/.test(lo) || /[;&|]\s*(?:del|erase)\b/.test(lo))
    return { policy: P.PERMANENT_DELETE_CMD, reason: "Permanent file deletion via del/erase is disabled. Use the trash tool instead." }
  if (/^(?:rd|rmdir)\b/.test(lo) || /[;&|]\s*(?:rd|rmdir)\b/.test(lo))
    return { policy: P.PERMANENT_DELETE_CMD, reason: "Permanent directory deletion via rd/rmdir is disabled. Use the trash tool instead." }
  return null
}

function detectPython(s: string): Block | null {
  const lo = s.toLowerCase()
  // Match python -c wrapper OR direct Python API patterns in any segment
  if (/\bos\.(?:remove|unlink|rmdir|removedirs)\b/.test(lo) ||
      /\bshutil\.rmtree\b/.test(lo) ||
      /\bpathlib\b.*\.(?:unlink|rmdir)\b/.test(lo) ||
      /\.unlink\(\)/.test(lo) || /\.rmdir\(\)/.test(lo) ||
      // R16 补齐（审计 B-09）：subprocess/os.system/popen 动态执行
      /\bsubprocess\.(?:call|run|popen|check_call|check_output|os\.system|os\.popen)\(/.test(lo) ||
      /\b__import__\(['"]shutil['"]\).*rmtree/.test(lo) ||
      /\bimportlib\.import_module\(['"]shutil['"]\).*rmtree/.test(lo))
    return { policy: P.PERMANENT_DELETE_PYTHON, reason: "Permanent file deletion via Python os.remove/shutil.rmtree is disabled." }
  return null
}

function detectNode(s: string): Block | null {
  const lo = s.toLowerCase()
  // Match Node.js fs deletion APIs (with or without fs. prefix, handles require('fs').rmSync etc.)
  if (/\brmsync\b/.test(lo) || /\brm\b.*\brecursive\b/.test(lo) ||
      /\bunlinksync\b/.test(lo) || /\brmdirsync\b/.test(lo) ||
      /\brimraf\b/.test(lo) ||
      // R16 补齐（审计 B-10）：child_process 动态执行
      /\bchild_process\b/.test(lo) || /\bexecsync\b/.test(lo) || /\bexecfile\b/.test(lo) ||
      /\bspawnsync\b/.test(lo) || /\bfs\.promises\.rm\b/.test(lo))
    return { policy: P.PERMANENT_DELETE_NODE, reason: "Permanent file deletion via Node.js fs.rmSync is disabled." }
  return null
}

function detectGit(s: string): Block | null {
  const lo = s.toLowerCase()
  if (/^git\s+clean\b/.test(lo))
    return { policy: P.GIT_CLEAN_DESTRUCTIVE, reason: "git clean can irreversibly discard uncommitted files." }
  if (/^git\s+reset\b/.test(lo) && /--hard/.test(lo))
    return { policy: P.GIT_RESET_HARD, reason: "git reset --hard can irreversibly discard uncommitted changes." }
  if (/^git\s+checkout\b/.test(lo) && /--\s*\./.test(lo))
    return { policy: P.GIT_WORKTREE_DISCARD, reason: "git checkout -- . discards uncommitted changes." }
  if (/^git\s+restore\b/.test(lo) && /\.\s*$/.test(lo))
    return { policy: P.GIT_WORKTREE_DISCARD, reason: "git restore . discards uncommitted changes." }
  // R16 补齐（审计 B-12）：9 种缺失 git 破坏
  if (/\bgit\s+push\b[^;&|]*--force/.test(lo) || /\bgit\s+push\b[^;&|]*\s-f\b/.test(lo))
    return { policy: P.GIT_WORKTREE_DISCARD, reason: "git push --force/-f overwrites remote history." }
  if (/\bgit\s+branch\s+-[dD]\b/.test(lo))
    return { policy: P.GIT_WORKTREE_DISCARD, reason: "git branch -d/-D force-deletes a branch." }
  if (/\bgit\s+stash\s+drop\b/.test(lo))
    return { policy: P.GIT_WORKTREE_DISCARD, reason: "git stash drop permanently discards stashes." }
  // switch -C 用原始 s 判断（lo 已小写化；s 保留大小写，-C 大写才匹配，安全的 -c 不误拦）
  if (/\bgit\s+switch\s+-C\b/.test(s))
    return { policy: P.GIT_WORKTREE_DISCARD, reason: "git switch -C force-resets branch." }
  if (/\bgit\s+gc\b[^;&|]*--prune/.test(lo))
    return { policy: P.GIT_WORKTREE_DISCARD, reason: "git gc --prune irreversibly drops objects." }
  if (/\bgit\s+reflog\s+expire\b/.test(lo))
    return { policy: P.GIT_WORKTREE_DISCARD, reason: "git reflog expire clears recovery references." }
  if (/\bgit\s+checkout\s+--\s+[^\s;|&]+/.test(lo) || /\bgit\s+restore\s+(?!\.\s*$)[^\s;|&]+/.test(lo))
    return { policy: P.GIT_WORKTREE_DISCARD, reason: "git checkout -- / restore discards file changes." }
  if (/\bgit\s+worktree\s+remove\s+--force/.test(lo))
    return { policy: P.GIT_WORKTREE_DISCARD, reason: "git worktree remove --force discards changes." }
  return null
}

function detectDisk(s: string): Block | null {
  const lo = s.toLowerCase()
  if (/^(?:format|format\.com)(?:\.exe)?\b/.test(lo) && /\b[a-z]:/.test(lo))
    return { policy: P.DISK_FORMAT_WINDOWS, reason: "Disk formatting erases all data." }
  if (/^diskpart(?:\.exe)?\b/.test(lo))
    return { policy: P.DISK_FORMAT_WINDOWS, reason: "diskpart can perform destructive disk operations." }
  if (/^(?:clear-disk|initialize-disk|remove-partition|format-volume)\b/.test(lo))
    return { policy: P.DISK_FORMAT_WINDOWS, reason: "PowerShell disk cmdlets can perform destructive operations." }
  if (/^(?:mkfs|fdisk|parted|wipefs)\b/.test(lo))
    return { policy: P.DISK_FORMAT_POSIX, reason: "Disk formatting erases all data." }
  if (/^dd\b/.test(lo) && /\bof\s*=\s*\//.test(lo))
    return { policy: P.DISK_WRITE_DEVICE, reason: "dd writing to device can destroy data." }
  // R16 补齐（审计 B-14）：truncate/docker/wmic/chmod 000/ln -sf 等效破坏
  if (/\btruncate\b[^;&|]*(?:\/dev\/|\\\\\.\\physicaldrive)/.test(lo))
    return { policy: P.DISK_WRITE_DEVICE, reason: "truncate to block device destroys data." }
  if (/\bdocker\s+(?:system\s+prune|volume\s+(?:rm|prune)|container\s+prune)/.test(lo))
    return { policy: P.DISK_FORMAT_POSIX, reason: "docker prune/volume rm destroys data." }
  if (/\bwmic\b[^;&|]*\bdelete\b/.test(lo) || /\bwmic\b[^;&|]*shadowcopy/.test(lo))
    return { policy: P.DISK_FORMAT_WINDOWS, reason: "wmic delete/shadowcopy destroys system state." }
  if (/\bchmod\s+(?:777|000|a\+rwx)\s+/.test(lo))
    return { policy: P.DISK_FORMAT_POSIX, reason: "chmod global/zero permissions is a security risk." }
  if (/\bln\s+-sf\s+\/dev\/null\s+/.test(lo))
    return { policy: P.DISK_FORMAT_POSIX, reason: "ln -sf /dev/null overwrites target destructively." }
  return null
}

// --- Target extraction for protected path checks ---
function extractTargets(s: string): string[] {
  const toks = s.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []
  const skip = /^(?:rm|del|erase|rmdir|rd|unlink|remove-item|ri|shred|find|format|diskpart|mkfs|fdisk|parted|dd|clear-content|clc|git|powershell|pwsh|cmd|bash|sh|node|python|py|echo|cat|type|dir|ls|mkdir|md|new-item|set|copy|move|ren|rename|touch|test|stat|wc|head|tail|grep|rg|findstr|where|which|whoami|date|time|hostname|systeminfo|tasklist|net|ipconfig|ping|curl|wget|npm|pnpm|yarn|npx|bun|deno|cargo|go|pip|pipenv|conda|brew|apt|apt-get|yum|dnf|pacman|winget|choco|scoop)$/i
  const flagRe = /^[-\/]/
  const targets: string[] = []
  let cmdFound = false
  for (const tok of toks) {
    const q = tok.replace(/^["']|["']$/g, "")
    if (!cmdFound) { if (!flagRe.test(q) && skip.test(q)) cmdFound = true; continue }
    if (flagRe.test(q)) continue
    if (/^[;&|&]$/.test(q)) { cmdFound = false; continue }
    if (q.length > 0) targets.push(q)
  }
  return targets
}

// --- Protected path mutation via shell redirect ---
function detectRedirect(s: string): Block | null {
  const lo = s.toLowerCase()
  const re = /(?:^|[^>&|;])>\s*(["']?)([^"'\s>&|;]+)\1/g
  let m: RegExpExecArray | null
  while ((m = re.exec(lo)) !== null) {
    const target = expandTilde(m[2])
    const pp = checkProtected(target)
    if (pp.hit) return { policy: P.PROTECTED_GUARD_MUTATION, reason: `Shell redirect targets protected path (${pp.label}).` }
  }
  return null
}

function hasDangerousSignal(cmd: string): boolean {
  const lo = cmd.toLowerCase()
  return /\brm\b/.test(lo) || /\bdel\b/.test(lo) || /\berase\b/.test(lo) ||
    /\brmdir\b/.test(lo) || /\brd\b/.test(lo) || /\bremove-item\b/.test(lo) ||
    /\bunlink\b/.test(lo) || /\bgit\s+clean\b/.test(lo) ||
    /\bgit\s+reset\b.*--hard/.test(lo) || /\bformat\b.*[a-z]:/.test(lo) ||
    /\bdiskpart\b/.test(lo) || /\bClear-Disk\b/.test(lo) || /\bdd\b.*of=/.test(lo) ||
    /\bmkfs\b/.test(lo) || /\bfdisk\b/.test(lo)
}

// --- 管道到 shell 检测（R16 补齐，审计 B-13）：curl|bash / echo|sh / cat|bash 等远程代码执行 ---
function detectPipe(s: string): Block | null {
  const lo = s.toLowerCase()
  if (/(?:curl|wget|iwr|echo|cat|printf|tee|base64|xxd)[^|;]*\|\s*(?:bash|sh|zsh|pwsh|powershell|iex|invoke-expression)\b/.test(lo))
    return { policy: P.REMOTE_EXECUTION_PIPE, reason: "Pipe to shell is remote code execution risk." }
  return null
}

// --- Main analysis ---
type AR = { blocked: false } | { blocked: true; policy: PolicyId; reason: string; command: string }

function analyzeCommand(command: string): AR {
  // R16 修复（B-13）：管道到 shell 在分段前检查完整命令（splitStmts 拆掉 | 会漏检测）
  const pipeHit = detectPipe(command)
  if (pipeHit) return { blocked: true, policy: pipeHit.policy, reason: pipeHit.reason, command }
  const segments = expandSegments(command)
  for (const seg of segments) {
    const t = seg.trim()
    if (!t) continue

    // Encoded command obfuscation
    if (t.startsWith("__ENCODED__"))
      return { blocked: true, policy: P.ENCODED_COMMAND_OBFUSCATION, reason: "PowerShell EncodedCommand detected - cannot verify safety.", command }

    // Guard plugin protection (run BEFORE detectors)
    const lo = t.toLowerCase()
    if (lo.includes("agent-risk-guard") && /\b(?:rm|del|erase|rmdir|rd|remove-item|unlink|move|mv|ren|rename)\b/.test(lo))
      return { blocked: true, policy: P.PROTECTED_GUARD_MUTATION, reason: "Attempt to delete/move the safety guard plugin.", command }
    if (lo.includes("destructive-operation-guard") && /\b(?:rm|del|erase|rmdir|rd|remove-item|unlink|move|mv|ren|rename)\b/.test(lo))
      return { blocked: true, policy: P.PROTECTED_GUARD_MUTATION, reason: "Attempt to delete/move the safety guard plugin (legacy name).", command }

    // Shell redirect to protected path
    const rd = detectRedirect(t)
    if (rd) return { blocked: true, policy: rd.policy, reason: rd.reason, command }

    // Run all detectors
    const detectors = [detectPOSIX, detectPowerShell, detectCMD, detectPython, detectNode, detectGit, detectDisk, detectPipe]
    for (const det of detectors) {
      const r = det(t)
      if (r) {
        // Check if targets hit protected paths
        const targets = extractTargets(t)
        for (const tgt of targets) {
          const pp = checkProtected(tgt)
          if (pp.hit) return { blocked: true, policy: P.PROTECTED_PATH_DELETE, reason: `Target "${tgt}" is protected (${pp.label}).`, command }
        }
        return { blocked: true, policy: r.policy, reason: r.reason, command }
      }
    }
  }
  return { blocked: false }
}
// --- Trash tool (Windows Recycle Bin) ---
function makeTrashTool($: any) {
  return tool({
    description: "Move a file or directory to the system recycle bin. Use this instead of rm/del/Remove-Item for file deletion.",
    args: { path: tool.schema.string() },
    async execute(args: { path: string }, context: any) {
      const targetPath = path.isAbsolute(args.path)
        ? args.path
        : path.resolve(context.directory || context.worktree, args.path)
      if (!fs.existsSync(targetPath))
        return { output: `Error: Path not found: ${targetPath}` }
      const isDir = fs.statSync(targetPath).isDirectory()
      const esc = targetPath.replace(/'/g, "''")
      const psCmd = isDir
        ? `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('${esc}', 'OnlyErrorDialogs', 'SendToRecycleBin')`
        : `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('${esc}', 'OnlyErrorDialogs', 'SendToRecycleBin')`
      try {
        execSync(`pwsh -NoProfile -NonInteractive -Command "${psCmd}"`, { timeout: 30000, windowsHide: true })
        return { output: `Moved to recycle bin: ${targetPath}` }
      } catch (e: any) {
        return { output: `Error: Could not move to recycle bin: ${e.message || e}. Do NOT fall back to permanent deletion.` }
      }
    },
  })
}

// --- Plugin export ---
const Guard: Plugin = async (ctx) => {
  return {
    "tool.execute.before": async (input: { tool: string; sessionID: string; callID: string }, output: { args: any }) => {
      try {
        // bash
        if (input.tool === "bash") {
          const cmd = output.args?.command
          if (!cmd || typeof cmd !== "string") return
          const r = analyzeCommand(cmd)
          if (r.blocked) {
            logBlock({ tool: "bash", policy: r.policy, command: r.command, reason: r.reason, sid: input.sessionID, wd: ctx.directory })
            throw new Error(`BLOCKED_BY_GLOBAL_SAFETY_GUARD\nPolicy: ${r.policy}\nReason: ${r.reason}`)
          }
        }
        // edit - protect guard plugin
        if (input.tool === "edit") {
          const fp = output.args?.filePath
          if (fp && typeof fp === "string") {
            const pp = checkProtected(fp)
            if (pp.hit && pp.label === "Guard plugin file") {
              logBlock({ tool: "edit", policy: P.PROTECTED_GUARD_MUTATION, command: `edit ${fp}`, reason: "Cannot modify the safety guard plugin.", sid: input.sessionID, wd: ctx.directory })
              throw new Error(`BLOCKED_BY_GLOBAL_SAFETY_GUARD\nPolicy: ${P.PROTECTED_GUARD_MUTATION}\nReason: Cannot modify the safety guard plugin.`)
            }
          }
        }
        // write - protect guard plugin
        if (input.tool === "write") {
          const fp = output.args?.filePath
          if (fp && typeof fp === "string") {
            const pp = checkProtected(fp)
            if (pp.hit && pp.label === "Guard plugin file") {
              logBlock({ tool: "write", policy: P.PROTECTED_GUARD_MUTATION, command: `write ${fp}`, reason: "Cannot overwrite the safety guard plugin.", sid: input.sessionID, wd: ctx.directory })
              throw new Error(`BLOCKED_BY_GLOBAL_SAFETY_GUARD\nPolicy: ${P.PROTECTED_GUARD_MUTATION}\nReason: Cannot overwrite the safety guard plugin.`)
            }
          }
        }
        // apply_patch - protect guard plugin
        if (input.tool === "apply_patch") {
          const pt = output.args?.patchText
          if (pt && typeof pt === "string") {
            const markers = [...pt.matchAll(/\*\*\*\s*(?:Delete|Update|Add|Move to)\s*File:\s*(.+)/g)]
            for (const m of markers) {
              const rel = m[1].trim()
              const abs = path.resolve(ctx.worktree, rel)
              const pp = checkProtected(abs)
              if (pp.hit && pp.label === "Guard plugin file") {
                logBlock({ tool: "apply_patch", policy: P.PROTECTED_GUARD_MUTATION, command: `patch -> ${rel}`, reason: "Cannot modify/delete the safety guard plugin via patch.", sid: input.sessionID, wd: ctx.directory })
                throw new Error(`BLOCKED_BY_GLOBAL_SAFETY_GUARD\nPolicy: ${P.PROTECTED_GUARD_MUTATION}\nReason: Cannot modify/delete the safety guard plugin via patch.`)
              }
            }
          }
        }
      } catch (e: any) {
        // Re-throw known block errors
        if (e?.message?.startsWith("BLOCKED_BY_GLOBAL_SAFETY_GUARD")) throw e
        // Fail-closed: crash + dangerous signal = block
        if (input.tool === "bash") {
          const cmd = String(output.args?.command || "")
          if (hasDangerousSignal(cmd)) {
            logBlock({ tool: "bash", policy: P.UNPARSEABLE_DESTRUCTIVE, command: cmd, reason: "Detection error with dangerous signal - fail-closed block.", sid: input.sessionID, wd: ctx.directory })
            throw new Error(`BLOCKED_BY_GLOBAL_SAFETY_GUARD\nPolicy: ${P.UNPARSEABLE_DESTRUCTIVE}\nReason: Detection failure with dangerous signal.`)
          }
        }
        // Unknown command without dangerous signal: allow
      }
    },
    tool: {
      trash: makeTrashTool((ctx as any).$),
    },
  }
}

// V1 plugin shape: id + server
export default { id: "agent-risk-guard", server: Guard }

// Export internals for testing (not loaded by V1 plugin loader)
export { analyzeCommand, checkProtected, expandSegments, detectPOSIX, detectPowerShell, detectCMD, detectPython, detectNode, detectGit, detectDisk, detectPipe, P }

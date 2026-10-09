/**
 * dsh-aire-memory — Aire 记忆插件（host 插件，纯 JS）。
 *
 * 读链路：每次「上岗」（agent/created，含新建/恢复会话）自动从 GitHub 拉取
 * 记忆仓库（krodon998/Aire-memory）的指定文件，缓存到内存 + 磁盘；通过
 * systemPrompt.context() 在每次模型组装时注入最新内容（order 数字小者靠前，
 * 默认 100，早于 SANDBOX_POLICY=110 等运行时上下文）。
 *
 * 写链路：只对根会话（header 无 parentSession、origin 非 subagent）生效。
 * agent/turn-stopping 防抖（默认 30s，期间来新消息即取消）+ agent/disposed
 * 立即触发。触发后插件自行调用 LLM 提取「值得长期记住的新信息」，按使用说明
 * 规则先拉取账本最新 SHA 再 PUT（SHA 锁兜底，409 冲突重取重试一次）。
 * 无实质变化则不提交、不更新「最后更新」行。
 *
 * 令牌解析顺序：credentials.resolve(tokenRef) → 环境变量 → config.githubToken
 * （config 引导值在加载时自动迁移进凭据库）。令牌绝不写入仓库任何文件。
 *
 * @module @dsh-external/dsh-aire-memory
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import z from '@deepseek-ai/schemastery'

const require = createRequire(import.meta.url)
const PKG_VERSION = (() => {
  try { return require('../package.json').version } catch { return 'unknown' }
})()

export const name = 'dsh-aire-memory'

/** 硬依赖：声明后装载器会等这些服务就绪再 apply（冷启动顺序保证） */
export const inject = ['systemPrompt', 'llm', 'credentials', 'agentDefaultModel', 'settings']

export const Config = z.object({
  /** GitHub 仓库（owner/repo）；留空 = 未配置，不注入任何内容（新手先通过令牌选择仓库） */
  repo: z.string().default(''),
  /** 分支 */
  branch: z.string().default('main'),
  /** 注入上下文时使用的文件（对话开始时拉取）；留空 = 自动发现仓库根目录 .md */
  injectFiles: z.array(z.string()).default([]),
  /** 仅拉取、供记忆提取器参考的文件（如使用说明.md 的安全规则） */
  extractorFiles: z.array(z.string()).default(['使用说明.md']),
  /** 写回的目标账本文件 */
  ledgerFile: z.string().default('长期记忆账本.md'),
  /** 注入上下文的排序号：数字小者靠前；现有运行时上下文从 110 起，100 = 排在最前 */
  injectOrder: z.number().default(100),
  /** 凭据库中的令牌引用名（env 同名变量也会被读取） */
  tokenRef: z.string().default('AIRE_MEMORY_GITHUB_TOKEN'),
  /** 引导用 GitHub 令牌：首次加载时自动迁移进凭据库；留空表示不启用 */
  githubToken: z.string().role('secret').default(''),
  /** 是否启用对话结束自动写回（默认关：保护新用户模型额度，想要再开） */
  writebackEnabled: z.boolean().default(false),
  /** 回合结束后的写回防抖（毫秒）：期间有新消息则取消 */
  writebackDebounceMs: z.number().default(30000),
  /** 送入提取器的对话转录最大字符数（取尾部） */
  maxTranscriptChars: z.number().default(16000),
  /** 转录低于该长度不触发提取 */
  minConversationChars: z.number().default(80),
  /** 提取模型覆盖（两者都填才生效；缺省用会话自身模型 / 默认模型） */
  extractProvider: z.string().default(''),
  extractModel: z.string().default(''),
  /** 拉取/写入超时（毫秒） */
  requestTimeoutMs: z.number().default(15000),
  /** 是否在右栏显示 Aire 记忆快捷面板图标 */
  showPanelIcon: z.boolean().default(true),
  /** 是否在每回合结束处显示记忆读写指示（v0.2b 生效） */
  showTurnIndicators: z.boolean().default(true),
  /** 面板内操作记录保留条数 */
  historyLimit: z.number().default(50),
  /** 每次拉取时自动发现仓库根目录的新 .md 文件并加入注入列表 */
  autoDiscoverFiles: z.boolean().default(true),
  /** 文件权限表：[{ file, mode: 'ro' | 'rw' }]，注入取全部，写回只取 rw */
  fileModes: z.array(z.object({ file: z.string(), mode: z.string().default('rw') })).default([]),
  /** 每 N 次对话写回一次（1 = 每次） */
  writebackEveryN: z.number().default(1),
  /** 会话策略：all | exclude | include */
  sessionPolicyMode: z.string().default('all'),
  /** 排除/包含的会话 id 列表 */
  sessionPolicyIds: z.array(z.string()).default([]),
  /** 写回有变动时在输入框上方显示全局小条提示 */
  showGlobalNotice: z.boolean().default(true),
  /** 每次写回最多处理的「读写」文件数 */
  maxWriteFiles: z.number().default(5),
})

const API_BASE = 'https://api.github.com'
const MAX_LEDGER_BYTES = 200000

/** 常见密钥形态脱敏（写入账本与送入提取器前各跑一遍） */
const SECRET_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/g,
]

function trunc(text, max) {
  const s = String(text ?? '')
  return s.length > max ? `${s.slice(0, max)}…` : s
}

function scrubSecrets(text, token) {
  let out = String(text ?? '')
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '[已脱敏]')
  if (token && token.length >= 8) out = out.split(token).join('[已脱敏]')
  return out
}

/** 宽松 JSON 解析：容忍 markdown 围栏与前后噪声 */
function parseJsonLoose(text) {
  const s = String(text ?? '')
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    return JSON.parse(s.slice(start, end + 1))
  } catch {
    return undefined
  }
}

function contentBlocksToText(blocks) {
  if (!Array.isArray(blocks)) return ''
  const parts = []
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    switch (block.type) {
      case 'text':
        if (block.text) parts.push(block.text)
        break
      case 'tool-call':
        parts.push(`[工具调用 ${block.name}(${trunc(block.arguments, 160)})]`)
        break
      case 'tool-result':
        parts.push(`[工具结果 ${trunc(contentBlocksToText(block.content), 300)}]`)
        break
      case 'image':
        parts.push('[图片]')
        break
      case 'file':
        parts.push(`[文件 ${block.attachment?.name ?? ''}]`)
        break
      default:
        break
    }
  }
  return parts.join('\n')
}

/** 把会话事件流序列化为「隐 / 小艾」风格的转录文本（截尾） */
function buildTranscript(session, maxChars) {
  const lines = []
  try {
    const events = session.snapshotEvents()
    for (const event of events) {
      switch (event.type) {
        case 'user/message': {
          const text = contentBlocksToText(event.data?.content).trim()
          if (text) lines.push(`[隐] ${text}`)
          break
        }
        case 'assistant/message': {
          const text = contentBlocksToText(event.data?.message?.content).trim()
          if (text) lines.push(`[小艾] ${text}`)
          break
        }
        case 'tool/call': {
          lines.push(`[工具调用] ${event.data?.name}(${trunc(event.data?.arguments, 200)})`)
          break
        }
        case 'tool/result': {
          const text = contentBlocksToText(event.data?.message?.content).trim()
          if (text) lines.push(`[工具结果] ${trunc(text, 300)}`)
          break
        }
        default:
          break
      }
    }
  } catch (error) {
    // 快照读取失败时退回空转录，由上层跳过
    return ''
  }
  let text = lines.join('\n').trim()
  if (text.length > maxChars) text = '……（更早的对话已省略）……\n' + text.slice(-maxChars)
  return text
}

export function apply(ctx, config) {
  const logger = ctx.logger ?? console
  const systemPrompt = ctx.get('systemPrompt')
  const llm = ctx.get('llm')
  const credentials = ctx.get('credentials')
  const agentDefaultModel = ctx.get('agentDefaultModel')

  const home = (() => {
    const fromEnv = process.env.DSH_HOME ?? process.env.DSH_PROFILE_DIR
    if (fromEnv) return fromEnv
    const dotDsh = join(homedir(), '.dsh')
    return existsSync(dotDsh) ? dotDsh : homedir()
  })()
  const cacheDir = join(home, 'cache', 'aire-memory')
  const snapshotPath = join(cacheDir, 'snapshot.json')
  const historyPath = join(cacheDir, 'history.json')
  const overridesPath = join(cacheDir, 'overrides.json')

  function readHistory() {
    try {
      const parsed = JSON.parse(readFileSync(historyPath, 'utf8'))
      if (Array.isArray(parsed)) return parsed
    } catch {
      /* 无历史 */
    }
    return []
  }

  function writeHistory() {
    try {
      mkdirSync(dirname(historyPath), { recursive: true })
      const tmp = `${historyPath}.tmp`
      writeFileSync(tmp, JSON.stringify(state.history, null, 2), 'utf8')
      renameSync(tmp, historyPath)
    } catch {
      /* 历史落盘失败不致命 */
    }
  }

  function readOverrides() {
    try {
      const parsed = JSON.parse(readFileSync(overridesPath, 'utf8'))
      if (parsed && typeof parsed === 'object') return parsed
    } catch {
      /* 无覆盖 */
    }
    return {}
  }

  function writeOverrides() {
    try {
      mkdirSync(dirname(overridesPath), { recursive: true })
      const tmp = `${overridesPath}.tmp`
      writeFileSync(tmp, JSON.stringify(state.overrides, null, 2), 'utf8')
      renameSync(tmp, overridesPath)
    } catch {
      /* 覆盖落盘失败不致命 */
    }
  }

  const state = {
    cache: readDiskCache(snapshotPath),
    lastPullAt: 0,
    pullPromise: undefined,
    sessions: new Map(), // sessionId -> Session（来自 session/event 的活引用）
    pending: new Map(), // sessionId -> Timeout（写回防抖）
    processing: new Set(), // 正在写回的 sessionId
    processedSeq: new Map(), // sessionId -> 已处理到的 seq
    history: readHistory(), // 操作记录（面板展示）
    lastWriteback: undefined, // 最近一次写回结果
    sessionWritebacks: new Map(), // sessionId -> 该会话最近一次写回记录（回合指示用）
    sessionTurns: new Map(), // sessionId -> 已结束回合计数（每 N 次写回）
    overrides: readOverrides(), // 面板运行时开关覆盖（即时生效、重启保留）
  }

  /** 面板/设置页可覆盖的运行时字段（tokenRef/githubToken/showPanelIcon/showTurnIndicators 除外） */
  const OVERRIDE_KEYS = new Set([
    'repo', 'branch', 'injectFiles', 'extractorFiles', 'ledgerFile', 'injectOrder',
    'writebackEnabled', 'writebackDebounceMs', 'maxTranscriptChars', 'minConversationChars',
    'extractProvider', 'extractModel', 'requestTimeoutMs', 'historyLimit', 'autoDiscoverFiles',
    'fileModes', 'writebackEveryN', 'sessionPolicyMode', 'sessionPolicyIds', 'showGlobalNotice', 'maxWriteFiles',
  ])

  /** 生效值：面板覆盖优先，其次插件配置 */
  function effective(key) {
    return state.overrides[key] !== undefined ? state.overrides[key] : config[key]
  }

  /** 文件权限表（fileModes 覆盖为空时从旧字段迁移一次） */
  function ensureFileModes() {
    let modes = effective('fileModes')
    if (!Array.isArray(modes) || modes.length === 0) {
      const legacyInject = Array.isArray(effective('injectFiles')) ? effective('injectFiles') : []
      const legacyExtract = Array.isArray(effective('extractorFiles')) ? effective('extractorFiles') : []
      const ledger = effective('ledgerFile')
      const map = new Map()
      for (const file of [...legacyInject, ...legacyExtract]) map.set(file, 'ro')
      if (ledger) map.set(ledger, 'rw')
      modes = [...map.entries()].map(([file, mode]) => ({ file, mode }))
      state.overrides.fileModes = modes
      writeOverrides()
    }
    return modes
  }

  /** 注入文件列表（ro + rw） */
  function readFiles() {
    return ensureFileModes().map((entry) => entry.file)
  }

  /** 写回文件列表（仅 rw） */
  function writeFiles() {
    return ensureFileModes().filter((entry) => entry.mode === 'rw').map((entry) => entry.file)
  }

  function setFileMode(file, mode) {
    const modes = ensureFileModes()
    const existing = modes.find((entry) => entry.file === file)
    if (existing) existing.mode = mode
    else modes.push({ file, mode })
    state.overrides.fileModes = modes
    writeOverrides()
  }

  /** 记录一条操作历史（内存 + 落盘），kind: pull | writeback */
  function recordHistory(entry) {
    state.history.unshift({ at: new Date().toISOString(), ...entry })
    if (state.history.length > effective('historyLimit')) state.history.length = effective('historyLimit')
    writeHistory()
  }

  // 注册本插件的设置页策略：settings 服务靠这个认识本条目（原生表单 + 面板配置写入都依赖它）
  const settingsService = ctx.get('settings')
  if (settingsService && typeof settingsService.configure === 'function') {
    ctx.effect(() => settingsService.configure({ auto: true }), 'aire-memory: settings policy')
  }

  // ---------- 令牌 ----------

  async function resolveToken() {
    if (credentials) {
      try {
        const resolved = await credentials.resolve(config.tokenRef)
        if (resolved?.value) return resolved.value
      } catch {
        /* 落入下一层 */
      }
    }
    if (process.env[config.tokenRef]) return process.env[config.tokenRef]
    if (config.githubToken) return config.githubToken
    return undefined
  }

  // 引导令牌迁移进凭据库（幂等）
  if (credentials && config.githubToken) {
    Promise.resolve()
      .then(() => credentials.resolve(config.tokenRef))
      .then((resolved) => {
        if (!resolved?.value) return credentials.set(config.tokenRef, config.githubToken)
        return undefined
      })
      .then(() => logger.info(`[aire-memory] github token 已写入凭据库（${config.tokenRef}），可从插件配置中移除 githubToken`))
      .catch((error) => logger.warn(`[aire-memory] 令牌迁移失败: ${error?.message ?? error}`))
  }

  // ---------- GitHub 客户端 ----------

  async function ghRequest(token, path, { method = 'GET', body, raw = false } = {}) {
    const headers = {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'dsh-aire-memory',
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(effective('requestTimeoutMs')),
    })
    if (!response.ok) {
      let detail = ''
      try { detail = trunc(await response.text(), 200) } catch { /* ignore */ }
      const error = new Error(`github ${method} ${path} -> ${response.status}: ${detail}`)
      error.status = response.status
      throw error
    }
    return response.json()
  }

  function filePath(file) {
    return `/repos/${effective('repo')}/contents/${encodeURIComponent(file)}?ref=${encodeURIComponent(effective('branch'))}`
  }

  async function readFileRaw(token, file) {
    return ghRequest(token, filePath(file), { raw: true })
  }

  async function readFile(token, file) {
    const json = await ghRequest(token, filePath(file))
    const text = Buffer.from(json.content ?? '', 'base64').toString('utf8')
    return { text, sha: json.sha }
  }

  async function writeFile(token, file, text, sha, message) {
    const json = await ghRequest(token, `/repos/${effective('repo')}/contents/${encodeURIComponent(file)}`, {
      method: 'PUT',
      body: {
        message,
        content: Buffer.from(text, 'utf8').toString('base64'),
        sha,
        branch: effective('branch'),
      },
    })
    return json.commit?.sha
  }

  // ---------- 磁盘缓存 ----------

  function readDiskCache(path) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'))
      if (parsed && parsed.files && typeof parsed.files === 'object') return parsed
    } catch {
      /* 无缓存 */
    }
    return undefined
  }

  function writeDiskCache(snapshot) {
    try {
      mkdirSync(dirname(snapshotPath), { recursive: true })
      const tmp = `${snapshotPath}.tmp`
      writeFileSync(tmp, JSON.stringify(snapshot, null, 2), 'utf8')
      renameSync(tmp, snapshotPath)
    } catch (error) {
      logger.warn(`[aire-memory] 磁盘缓存写入失败: ${error?.message ?? error}`)
    }
  }

  /** 写回状态落盘：宿主控制台日志不可见时的观测口（cache/aire-memory/writeback-last.json） */
  function writeStatus(record) {
    state.lastWriteback = { at: new Date().toISOString(), ...record }
    if (record.sessionId) state.sessionWritebacks.set(record.sessionId, { ...state.lastWriteback })
    try {
      mkdirSync(dirname(snapshotPath), { recursive: true })
      writeFileSync(join(cacheDir, 'writeback-last.json'), JSON.stringify({ at: new Date().toISOString(), ...record }, null, 2), 'utf8')
    } catch {
      /* 状态写入失败不致命 */
    }
    recordHistory({
      kind: 'writeback',
      status: record.phase === 'committed' ? 'ok' : record.phase === 'error' ? 'error' : record.phase === 'skipped' ? 'skip' : 'warn',
      message: record.phase === 'committed'
        ? `记忆已写回并提交（${record.summary ?? ''}）`
        : record.phase === 'skipped'
          ? `跳过写回（${record.reason === 'no-change' ? '无新记忆' : '对话过短'}）`
          : record.phase === 'error'
            ? `写回失败：${record.message ?? ''}`
            : `写回尝试（seq ${record.seq ?? '-'}）`,
    })
  }

  // ---------- 拉取（读链路） ----------

  async function pullAll() {
    if (state.pullPromise) return state.pullPromise
    state.pullPromise = (async () => {
      const now = Date.now()
      if (now - state.lastPullAt < 20000) return false
      if (!effective('repo')) {
        logger.info('[aire-memory] 未配置记忆仓库，跳过拉取（在设置页用令牌选择仓库）')
        return false
      }
      const token = await resolveToken()
      if (!token) {
        logger.warn(`[aire-memory] 未配置 GitHub 令牌（${config.tokenRef} / 环境变量 / githubToken），跳过拉取`)
        return false
      }
      // 自动发现：列出仓库根目录的 .md 文件，新文件自动加入权限表（默认读写）
      // （含 {{ 模板语法的文件跳过，避免注入时被提示词组装器当作变量报错）
      if (effective('autoDiscoverFiles') !== false) {
        try {
          const tree = await ghRequest(token, `/repos/${effective('repo')}/git/trees/${encodeURIComponent(effective('branch'))}?recursive=1`)
          const mdFiles = (tree?.tree ?? [])
            .filter((entry) => entry?.type === 'blob' && typeof entry?.path === 'string' && !entry.path.includes('/') && entry.path.endsWith('.md'))
            .map((entry) => entry.path)
          const known = readFiles()
          const candidates = mdFiles.filter((file) => !known.includes(file))
          const freshFiles = []
          for (const file of candidates) {
            try {
              const text = await readFileRaw(token, file)
              if (/\{\{/.test(text)) {
                logger.info(`[aire-memory] 自动发现跳过（含模板语法）: ${file}`)
              } else {
                freshFiles.push(file)
              }
            } catch {
              /* 读不了就先跳过，下次拉取再试 */
            }
          }
          for (const file of freshFiles) setFileMode(file, 'rw')
          if (freshFiles.length > 0) {
            logger.info(`[aire-memory] 自动发现新文件并加入权限表（读写）: ${freshFiles.join('、')}`)
            recordHistory({ kind: 'discover', status: 'ok', message: `发现新文件并自动加入（读写）：${freshFiles.join('、')}` })
          }
        } catch (error) {
          logger.warn(`[aire-memory] 自动发现文件失败（保持原列表）: ${error?.message ?? error}`)
        }
      }
      const wanted = [...new Set(readFiles())]
      const merged = { ...(state.cache?.files ?? {}) } // 失败的保留旧值
      let fresh = 0
      let failed = 0
      await Promise.all(wanted.map(async (file) => {
        try {
          const { text, sha } = await readFile(token, file)
          merged[file] = { text, sha, fetchedAt: now }
          fresh += 1
        } catch (error) {
          failed += 1
          logger.warn(`[aire-memory] 拉取 ${file} 失败: ${error?.message ?? error}`)
        }
      }))
      state.lastPullAt = now
      if (fresh === 0) {
        if (state.cache) state.cache = { ...state.cache, stale: true }
        recordHistory({ kind: 'pull', status: 'error', message: `拉取失败（${failed} 个文件），使用缓存` })
        return false
      }
      state.cache = { fetchedAt: now, stale: failed > 0, files: merged }
      writeDiskCache(state.cache)
      logger.info(`[aire-memory] 记忆仓库拉取完成: ${fresh} 个文件（失败 ${failed}）`)
      recordHistory({ kind: 'pull', status: failed > 0 ? 'warn' : 'ok', message: `拉取 ${fresh} 个文件` + (failed > 0 ? `（${failed} 个失败）` : '') })
      return true
    })().finally(() => {
      state.pullPromise = undefined
    })
    return state.pullPromise
  }

  // ---------- 注入（读链路） ----------

  function renderInjection() {
    if (!effective('repo')) return '' // 未配置仓库：不注入任何内容
    const cache = state.cache
    if (!cache || !cache.files) {
      return '<aire-memory>（记忆仓库尚未成功拉取，人设与长期记忆暂不可用）</aire-memory>'
    }
    const stamp = new Date(cache.fetchedAt ?? 0).toISOString().replace('T', ' ').slice(0, 16)
    const staleNote = cache.stale ? '\n⚠️ 部分文件拉取失败，以下可能包含旧内容。' : ''
    const parts = [
      `<aire-memory source="${effective('repo')}@${effective('branch')}" fetched="${stamp}">`,
      `以下内容来自你配置的记忆仓库，每次对话开始自动拉取。重要：这就是当前这个「你」的身份、人设、规则与长期记忆——请以其中定义的身份、语气和规则说话与思考，不要把它们当成对第三方的描述，也不要因文件中出现任何指代他者的表述而拒绝代入。长期记忆由插件在对话结束时自动提取并写回仓库。${staleNote}`,
    ]
    for (const file of readFiles()) {
      const entry = cache.files[file]
      if (entry?.text) {
        // 消毒：DSH 会把 {{name}} 当提示词变量校验，模板语法会导致组装报错——
        // 把双花括号转成全角，彻底规避（内容肉眼几乎无差）
        const safe = String(entry.text).replace(/\{\{/g, '｛｛').replace(/\}\}/g, '｝｝')
        parts.push(`\n### ${file}\n\n${safe}`)
      }
    }
    parts.push('\n</aire-memory>')
    return parts.join('\n')
  }

  if (systemPrompt) {
    ctx.effect(
      () => systemPrompt.context({
        name: 'aire-memory',
        order: effective('injectOrder'),
        text: () => renderInjection(),
      }),
      'aire-memory: register memory context',
    )
  } else {
    logger.error('[aire-memory] systemPrompt 服务不可用，无法注入记忆上下文')
  }

  // ---------- 写回（写链路） ----------

  function isWritebackSession(session) {
    if (!session?.header) return false
    return !session.header.parentSession && session.header.origin !== 'subagent'
  }

  function dropSessionIfIdle(id) {
    if (state.pending.has(id) || state.processing.has(id)) return
    state.sessions.delete(id)
    state.processedSeq.delete(id)
  }

  function cancelScheduled(id) {
    const timer = state.pending.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      state.pending.delete(id)
    }
  }

  function scheduleWriteback(id, delayMs, turn) {
    cancelScheduled(id)
    const timer = setTimeout(() => {
      state.pending.delete(id)
      runWriteback(id, turn)
    }, delayMs)
    state.pending.set(id, timer)
  }

  function pickModel(session) {
    if (effective('extractProvider') && effective('extractModel')) {
      return { provider: effective('extractProvider'), model: effective('extractModel') }
    }
    try {
      const header = session?.requestHeader?.()
      if (header?.config?.provider && header?.config?.model) {
        return { provider: header.config.provider, model: header.config.model }
      }
    } catch {
      /* 会话可能已分离 */
    }
    if (agentDefaultModel) {
      try {
        const selection = agentDefaultModel.currentSelection()
        if (selection?.provider && selection?.model) {
          return { provider: selection.provider, model: selection.model }
        }
      } catch {
        /* 落入失败 */
      }
    }
    return undefined
  }

  async function llmComplete(model, system, user) {
    const chunks = []
    let finish
    const stream = llm.stream({
      provider: model.provider,
      model: model.model,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
      temperature: 0.2,
    })[Symbol.asyncIterator]()
    const CHUNK_TIMEOUT_MS = 180000 // 单块 180 秒无输出即判超时，避免提取永远挂起
    while (true) {
      const result = await Promise.race([
        stream.next(),
        new Promise((resolve, reject) => setTimeout(() => reject(new Error('提取模型调用超时（120 秒无输出）')), CHUNK_TIMEOUT_MS)),
      ])
      if (result.done) break
      const chunk = result.value
      if (chunk.type === 'text-delta') chunks.push(chunk.text)
      if (chunk.type === 'finish') finish = chunk.reason
    }
    if (finish && (finish.kind === 'error' || finish.kind === 'aborted')) {
      throw new Error(`提取模型调用失败: ${finish.kind} ${finish.failure?.message ?? ''}`)
    }
    return chunks.join('')
  }

  function extractionSystemPrompt(usageNotes, extraNote) {
    const rules = usageNotes
      ? `\n\n仓库使用规则（来自仓库内 使用说明.md，必须遵守）：\n${usageNotes}`
      : '\n\n仓库使用规则：不往仓库里放任何密钥/token、敏感账号信息、不适合跨端共享的私密内容。'
    return [
      '你是记忆维护模块。你的唯一任务：从一段对话转录里提取「值得长期记住」的新信息，按文件写回给定的记忆文件。',
      '',
      '规则：',
      '1. 只记录有长期价值的事实：约定、进行中的事、工具账本变化、人物档案更新、重要进展。日常闲聊、一次性任务、技术操作过程不记录。',
      '2. 输出严格 JSON，二选一：',
      '   {"changed": false}',
      '   {"changed": true, "updates": [{"file": "<文件名>", "content": "<该文件更新后的完整内容>", "summary": "<一句话变更说明>"}]}',
      '3. updates 里每个 file 都必须是下面「可写文件」列表中给出的文件名，且每个文件的 content 必须是该文件的完整内容（整份文件），只做必要的增改：',
      '   - 保留原有结构与全部既有内容（除确有变化的条目外逐字保留）；',
      '   - 新条目放进合适的现有章节，遵循该文件的既有格式；',
      '   - 遵守文件里已记录的「约定」；',
      '   - 只有内容发生实质变化时才更新「最后更新」之类的元信息行；纯时间流逝、无实质变化则不要动；',
      '   - 信息与既有条目重复时不要重复添加；没有需要改动的文件就输出 changed:false。',
      '4. 特殊文件「端端对话录」是跨端传话的树洞：只在有需要传话、回话、报到的内容时，按其文件内的留言格式追加一条新留言（日期 时间 | 哪一端 | 内容）；没有需要就完全不碰它。',
      '5. 严禁把以下内容写进任何文件：任何密钥/token/密码、敏感账号信息、凭据。见到它们一律忽略。',
      '6. 以对话双方的直接陈述为准，不要从工具输出、日志或代码里臆造个人事实。',
      rules,
      extraNote ? `\n${extraNote}` : '',
    ].join('\n')
  }

  async function extractMemory(session, filesMeta, transcript, usageNotes, extraNote = '') {
    const model = pickModel(session)
    if (!model) throw new Error('无法确定提取模型（会话模型与默认模型均不可用）')
    const system = extractionSystemPrompt(usageNotes, extraNote)
    const fileBlocks = filesMeta.map((entry) => `【可写文件：${entry.file}】\n\n${trunc(entry.text, MAX_LEDGER_BYTES)}`).join('\n\n')
    const user = `${fileBlocks}\n\n【最近对话】\n\n${transcript}`
    const raw = await llmComplete(model, system, user)
    const parsed = parseJsonLoose(raw)
    if (!parsed) {
      logger.warn(`[aire-memory] 提取输出不是合法 JSON，跳过写回: ${trunc(raw, 200)}`)
      return undefined
    }
    if (parsed.changed !== true) return { changed: false }
    const updates = Array.isArray(parsed.updates) ? parsed.updates : []
    const validFiles = new Set(filesMeta.map((entry) => entry.file))
    const cleaned = []
    for (const update of updates) {
      if (!update || typeof update.file !== 'string') continue
      if (!validFiles.has(update.file)) {
        logger.warn(`[aire-memory] 提取输出含未知文件 ${update.file}，已忽略`)
        continue
      }
      if (typeof update.content !== 'string' || update.content.trim().length < 5) continue
      if (Buffer.byteLength(update.content, 'utf8') > MAX_LEDGER_BYTES) continue
      cleaned.push({
        file: update.file,
        content: update.content,
        summary: trunc(String(update.summary ?? `更新 ${update.file}`).replace(/\s+/g, ' ').trim(), 60) || `更新 ${update.file}`,
      })
    }
    if (cleaned.length === 0) return { changed: false }
    return { changed: true, updates: cleaned }
  }

  function isSessionIncluded(id) {
    const mode = effective('sessionPolicyMode')
    const ids = Array.isArray(effective('sessionPolicyIds')) ? effective('sessionPolicyIds') : []
    if (mode === 'exclude') return !ids.includes(id)
    if (mode === 'include') return ids.includes(id)
    return true
  }

  function shouldWritebackNow(id) {
    const n = Math.max(1, Number(effective('writebackEveryN')) || 1)
    if (n <= 1) return true
    const count = (state.sessionTurns.get(id) ?? 0) + 1
    state.sessionTurns.set(id, count)
    return count % n === 0
  }

  async function runWriteback(id, turn) {
    const session = state.sessions.get(id)
    if (!session || !isWritebackSession(session)) return
    if (!effective('writebackEnabled')) return
    if (!effective('repo')) return
    if (!isSessionIncluded(id)) return
    if (state.processing.has(id)) return
    const seq = session.seq
    if (state.processedSeq.get(id) !== undefined && seq <= state.processedSeq.get(id)) return

    const status = (record) => writeStatus({ turn, ...record })

    state.processing.add(id)
    status({ sessionId: id, phase: 'attempt', seq })
    try {
      if (!shouldWritebackNow(id)) {
        status({ sessionId: id, phase: 'skipped', reason: 'every-n', seq })
        state.processedSeq.set(id, seq)
        return
      }
      const transcript = buildTranscript(session, effective('maxTranscriptChars'))
      if (transcript.length < effective('minConversationChars')) {
        status({ sessionId: id, phase: 'skipped', reason: 'transcript-too-short', seq })
        state.processedSeq.set(id, seq)
        return
      }
      const token = await resolveToken()
      if (!token) throw new Error('未配置 GitHub 令牌，跳过写回')

      // 目标文件：读写权限，账本排最前，最多 maxWriteFiles 个
      const ledger = effective('ledgerFile')
      const targets = writeFiles()
        .sort((a, b) => (a === ledger ? -1 : b === ledger ? 1 : a.localeCompare(b)))
        .slice(0, Math.max(1, Number(effective('maxWriteFiles')) || 5))

      const usageNotes = state.cache?.files?.['使用说明.md']?.text ?? ''
      const filesMeta = []
      for (const file of targets) {
        const current = await readFile(token, file)
        filesMeta.push({ file, text: current.text, sha: current.sha })
      }

      const extracted = await extractMemory(session, filesMeta, transcript, usageNotes)
      if (!extracted || extracted.changed !== true) {
        status({ sessionId: id, phase: 'skipped', reason: 'no-change', seq })
        state.processedSeq.set(id, seq)
        return
      }

      let committed = 0
      for (const update of extracted.updates) {
        const meta = filesMeta.find((entry) => entry.file === update.file)
        if (!meta) continue
        const nextContent = scrubSecrets(update.content, token)
        try {
          await writeFile(token, update.file, nextContent, meta.sha, `记忆写回（DSH）：${update.summary}`)
          committed += 1
          if (state.cache?.files) {
            state.cache.files[update.file] = { text: nextContent, sha: undefined, fetchedAt: Date.now() }
          }
        } catch (error) {
          if (!error?.status || (error.status !== 409 && error.status !== 422)) throw error
          logger.warn(`[aire-memory] ${update.file} SHA 冲突，重取后重试一次`)
          const fresh = await readFile(token, update.file)
          await writeFile(token, update.file, nextContent, fresh.sha, `记忆写回（DSH）：${update.summary}`)
          committed += 1
          if (state.cache?.files) {
            state.cache.files[update.file] = { text: nextContent, sha: undefined, fetchedAt: Date.now() }
          }
        }
      }
      if (committed > 0) writeDiskCache(state.cache)
      const summary = `记忆写回：${extracted.updates.map((update) => update.file).join('、')}`
      logger.info(`[aire-memory] ${summary}（${committed} 个文件）`)
      status({ sessionId: id, phase: committed > 0 ? 'committed' : 'skipped', summary, seq, reason: committed > 0 ? undefined : 'no-change' })
      state.processedSeq.set(id, seq)
    } catch (error) {
      logger.error(`[aire-memory] 写回失败（${id}）: ${error?.message ?? error}`)
      status({ sessionId: id, phase: 'error', message: String(error?.message ?? error), seq })
    } finally {
      state.processing.delete(id)
      dropSessionIfIdle(id)
    }
  }

  // ---------- 面板状态端点（客户端半边读取） ----------

  async function tokenStatus() {
    if (credentials) {
      try {
        const resolved = await credentials.resolve(config.tokenRef)
        if (resolved?.value) {
          // 本地凭据库报告 source 为 "file"，统一成 "credentials" 给面板显示
          const source = resolved.source === 'file' ? 'credentials' : (resolved.source ?? 'credentials')
          return { configured: true, source }
        }
      } catch {
        /* 落入下一层 */
      }
    }
    if (process.env[config.tokenRef]) return { configured: true, source: 'env' }
    if (config.githubToken) return { configured: true, source: 'config' }
    return { configured: false, source: null }
  }

  async function buildStatus() {
    const token = await tokenStatus()
    return {
      ok: true,
      version: PKG_VERSION,
      repo: effective('repo'),
      branch: effective('branch'),
      token,
      writebackEnabled: effective('writebackEnabled'),
      cache: state.cache
        ? { fetchedAt: state.cache.fetchedAt, stale: state.cache.stale === true, files: Object.keys(state.cache.files ?? {}) }
        : null,
      lastWriteback: state.lastWriteback ?? null,
      history: state.history.slice(0, 20),
      settingsNs: resolveSettingsNs() ?? null,
      overrides: { ...state.overrides },
      settings: {
        repo: effective('repo'),
        branch: effective('branch'),
        injectFiles: effective('injectFiles'),
        extractorFiles: effective('extractorFiles'),
        ledgerFile: effective('ledgerFile'),
        injectOrder: effective('injectOrder'),
        writebackEnabled: effective('writebackEnabled'),
        writebackDebounceMs: effective('writebackDebounceMs'),
        maxTranscriptChars: effective('maxTranscriptChars'),
        minConversationChars: effective('minConversationChars'),
        extractProvider: effective('extractProvider'),
        extractModel: effective('extractModel'),
        requestTimeoutMs: effective('requestTimeoutMs'),
        historyLimit: effective('historyLimit'),
        autoDiscoverFiles: effective('autoDiscoverFiles') !== false,
        fileModes: ensureFileModes().map((entry) => ({ ...entry })),
        writebackEveryN: Number(effective('writebackEveryN')) || 1,
        sessionPolicyMode: effective('sessionPolicyMode'),
        sessionPolicyIds: Array.isArray(effective('sessionPolicyIds')) ? [...effective('sessionPolicyIds')] : [],
        showGlobalNotice: effective('showGlobalNotice') !== false,
        maxWriteFiles: Number(effective('maxWriteFiles')) || 5,
      },
    }
  }

  function sendJson(res, payload, code = 200) {
    const body = JSON.stringify(payload)
    res.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-cache, max-age=0, must-revalidate',
    })
    res.end(body)
  }

  function readJsonBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8')
          resolve(raw ? JSON.parse(raw) : {})
        } catch (error) {
          reject(error)
        }
      })
      req.on('error', reject)
    })
  }

  /** 找到本插件的 settings 命名空间（以 schema 特征字段匹配，避免硬编码 entry id） */
  /** 递归在 anyOf/oneOf/allOf 包裹的 JSON Schema 里找特征 properties */
  function findSchemaProps(schema) {
    if (!schema || typeof schema !== 'object') return undefined
    const props = schema.properties
    if (props && typeof props === 'object' && 'tokenRef' in props && 'showPanelIcon' in props) return props
    for (const branchKey of ['anyOf', 'oneOf', 'allOf']) {
      const branch = schema[branchKey]
      if (Array.isArray(branch)) {
        for (const item of branch) {
          const hit = findSchemaProps(item)
          if (hit) return hit
        }
      }
    }
    return undefined
  }

  function resolveSettingsNs() {
    const service = ctx.get('settings')
    if (!service || typeof service.describe !== 'function') return undefined
    try {
      const descriptors = service.describe()
      for (const descriptor of descriptors) {
        if (findSchemaProps(descriptor?.schema)) return descriptor.ns
      }
    } catch {
      /* 落入候选回退 */
    }
    return undefined
  }

  // webServer 在 web 类 profile 才有：用 ctx.inject 延迟注册，服务就绪后回调执行
  ctx.inject(['webServer'], (webCtx) => {
    const webServer = webCtx.webServer
    if (!webServer) return
    const disposers = [
      webServer.register({
        kind: 'exact',
        path: '/aire-memory/repos',
        handler: async (req, res) => {
          if (req.method !== 'GET') {
            res.writeHead(405, { allow: 'GET' })
            res.end()
            return
          }
          const token = await resolveToken().catch(() => null)
          if (!token) {
            sendJson(res, { ok: false, error: '未配置令牌：请先在设置页粘贴并保存 GitHub 令牌', repos: [] })
            return
          }
          try {
            const all = []
            for (let page = 1; page <= 3; page += 1) {
              const list = await ghRequest(token, `/user/repos?per_page=100&page=${page}&sort=pushed`)
              if (!Array.isArray(list) || list.length === 0) break
              all.push(...list)
              if (list.length < 100) break
            }
            const repos = all
              .filter((entry) => entry && typeof entry.full_name === 'string' && (entry.permissions?.push === true || entry.permissions?.admin === true))
              .map((entry) => ({ full_name: entry.full_name, private: !!entry.private, description: entry.description ?? '' }))
            sendJson(res, { ok: true, count: repos.length, repos })
          } catch (error) {
            const status = error?.status ?? 0
            const message = status === 401 || status === 403
              ? '令牌无效或已过期：请回到 GitHub 重新生成令牌（细颗粒度，授权目标仓库 Contents 读写）'
              : `获取仓库列表失败：${error?.message ?? error}`
            sendJson(res, { ok: false, error: message, repos: [] })
          }
        },
      }),
      webServer.register({
        kind: 'exact',
        path: '/aire-memory/init',
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405, { allow: 'POST' })
            res.end()
            return
          }
          const repo = effective('repo')
          if (!repo) {
            sendJson(res, { ok: false, message: '先选择记忆仓库' })
            return
          }
          const token = await resolveToken().catch(() => null)
          if (!token) {
            sendJson(res, { ok: false, message: '先配置 GitHub 令牌' })
            return
          }
          const LEDGER_TEMPLATE = [
            '# 长期记忆账本',
            '',
            '> 最后更新：由 Get记忆 插件在每次写回时自动维护',
            '',
            '## 正在进行',
            '- 暂无',
            '',
            '## 约定',
            '- 暂无',
            '',
            '## 工具账本',
            '- 暂无',
            '',
            '## 档案',
            '- 暂无',
            '',
          ].join('\n')
          try {
            await ghRequest(token, `/repos/${repo}/contents/${encodeURIComponent('长期记忆账本.md')}`, {
              method: 'PUT',
              body: {
                message: 'chore: 初始化长期记忆账本（由 Get记忆 插件创建）',
                content: Buffer.from(LEDGER_TEMPLATE, 'utf8').toString('base64'),
              },
            })
            setFileMode('长期记忆账本.md', 'rw')
            await pullAll().catch(() => false)
            recordHistory({ kind: 'init', status: 'ok', message: `已创建 长期记忆账本.md（${repo}）` })
            sendJson(res, { ...(await buildStatus()), initOk: true, created: '长期记忆账本.md' })
          } catch (error) {
            if (error?.status === 422) {
              sendJson(res, { ok: false, exists: true, message: '长期记忆账本.md 已存在，无需初始化' })
            } else {
              sendJson(res, { ok: false, message: `初始化失败：${error?.message ?? error}` })
            }
          }
        },
      }),
      webServer.register({
        kind: 'exact',
        path: '/aire-memory/status',
        handler: async (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { allow: 'GET, HEAD' })
            res.end()
            return
          }
          sendJson(res, await buildStatus())
        },
      }),
      webServer.register({
        kind: 'exact',
        path: '/aire-memory/pull',
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405, { allow: 'POST' })
            res.end()
            return
          }
          const ok = await pullAll().catch((error) => {
            logger.error(`[aire-memory] 手动拉取失败: ${error?.message ?? error}`)
            return false
          })
          // 20 秒去重窗口内返回 false 属正常：缓存刚拉过也算成功
          const freshCache = !!state.cache && Date.now() - (state.cache.fetchedAt ?? 0) < 60000
          sendJson(res, { ...(await buildStatus()), pullOk: ok === true || freshCache })
        },
      }),
      webServer.register({
        kind: 'exact',
        path: '/aire-memory/writeback',
        handler: async (req, res) => {
          if (req.method !== 'GET') {
            res.writeHead(405, { allow: 'GET' })
            res.end()
            return
          }
          const url = new URL(req.url ?? '/', 'http://local')
          const session = url.searchParams.get('session') ?? ''
          const turnRaw = url.searchParams.get('turn')
          const seqRaw = url.searchParams.get('seq')
          const record = state.sessionWritebacks.get(session)
          let matched = null
          if (record) {
            const turn = turnRaw !== null && turnRaw !== '' ? Number(turnRaw) : Number.NaN
            const seq = seqRaw !== null && seqRaw !== '' ? Number(seqRaw) : Number.NaN
            if (!Number.isNaN(turn)) {
              matched = record.turn === turn ? record : null
            } else if (!Number.isNaN(seq)) {
              matched = Math.abs((record.seq ?? 0) - seq) <= 20 ? record : null
            } else {
              matched = record
            }
          }
          sendJson(res, {
            ok: true,
            found: !!matched,
            record: matched
              ? {
                  at: matched.at,
                  phase: matched.phase,
                  summary: matched.summary ?? null,
                  reason: matched.reason ?? null,
                  message: matched.message ?? null,
                  turn: matched.turn ?? null,
                  seq: matched.seq ?? null,
                }
              : null,
          })
        },
      }),
      webServer.register({
        kind: 'exact',
        path: '/aire-memory/token',
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405, { allow: 'POST' })
            res.end()
            return
          }
          try {
            const body = await readJsonBody(req)
            const value = typeof body.token === 'string' ? body.token.trim() : ''
            if (!value || value.length < 20 || value.length > 200) {
              sendJson(res, { ok: false, message: '令牌格式不对（20~200 字符）' })
              return
            }
            if (!credentials) {
              sendJson(res, { ok: false, message: '凭据服务不可用' })
              return
            }
            await credentials.set(config.tokenRef, value)
            // 保存后立刻用新令牌做一次只读验证
            let verified = false
            let verifyMessage = ''
            try {
              await readFile(value, effective('ledgerFile'))
              verified = true
            } catch (error) {
              verifyMessage = String(error?.message ?? error).slice(0, 160)
            }
            recordHistory({ kind: 'token', status: verified ? 'ok' : 'error', message: verified ? '令牌已保存并验证通过' : '令牌已保存但验证失败' })
            sendJson(res, { ok: true, verified, verifyMessage })
          } catch (error) {
            logger.error(`[aire-memory] 令牌保存失败: ${error?.message ?? error}`)
            sendJson(res, { ok: false, message: String(error?.message ?? error).slice(0, 200) })
          }
        },
      }),
      webServer.register({
        kind: 'exact',
        path: '/aire-memory/config',
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405, { allow: 'POST' })
            res.end()
            return
          }
          try {
            const body = await readJsonBody(req)
            const patch = body && typeof body.patch === 'object' && body.patch !== null ? body.patch : {}
            const entries = Object.entries(patch).filter(([key]) => OVERRIDE_KEYS.has(key))
            if (entries.length === 0) {
              sendJson(res, { ok: false, message: '没有可写的开关项' })
              return
            }
            for (const [key, value] of entries) state.overrides[key] = value
            writeOverrides()
            recordHistory({ kind: 'config', status: 'ok', message: '面板开关更新：' + entries.map(([key]) => key).join(', ') })
            sendJson(res, { ok: true, overrides: { ...state.overrides } })
          } catch (error) {
            logger.error(`[aire-memory] 配置保存失败: ${error?.message ?? error}`)
            sendJson(res, { ok: false, message: String(error?.message ?? error).slice(0, 200) })
          }
        },
      }),
      webServer.register({
        kind: 'exact',
        path: '/aire-memory/filesync',
        handler: async (req, res) => {
          try {
            const token = await resolveToken()
            if (!token) {
              sendJson(res, { ok: false, message: '未配置 GitHub 令牌' })
              return
            }
            if (req.method === 'GET') {
              // 拉取仓库当前 .md 清单，对照权限表给出新增/删除/模式
              const tree = await ghRequest(token, `/repos/${effective('repo')}/git/trees/${encodeURIComponent(effective('branch'))}?recursive=1`)
              const repoFiles = (tree?.tree ?? [])
                .filter((entry) => entry?.type === 'blob' && typeof entry?.path === 'string' && !entry.path.includes('/') && entry.path.endsWith('.md'))
                .map((entry) => entry.path)
              const modes = ensureFileModes()
              const modeMap = new Map(modes.map((entry) => [entry.file, entry.mode]))
              const files = repoFiles.map((file) => ({
                file,
                mode: modeMap.get(file) ?? 'rw', // 新文件默认读写
                isNew: !modeMap.has(file),
              }))
              const removed = modes.filter((entry) => !repoFiles.includes(entry.file)).map((entry) => entry.file)
              sendJson(res, { ok: true, files, removed })
              return
            }
            if (req.method === 'POST') {
              const body = await readJsonBody(req)
              const modes = Array.isArray(body?.modes) ? body.modes : []
              let applied = 0
              for (const item of modes) {
                if (!item || typeof item.file !== 'string') continue
                const mode = item.mode === 'ro' ? 'ro' : 'rw'
                setFileMode(item.file, mode)
                applied += 1
              }
              recordHistory({ kind: 'config', status: 'ok', message: `文件权限更新（${applied} 个）` })
              sendJson(res, { ok: true, applied })
              return
            }
            res.writeHead(405, { allow: 'GET, POST' })
            res.end()
          } catch (error) {
            logger.error(`[aire-memory] 文件同步失败: ${error?.message ?? error}`)
            sendJson(res, { ok: false, message: String(error?.message ?? error).slice(0, 200) })
          }
        },
      }),
    ]
    ctx.effect(() => () => {
      for (const dispose of disposers) {
        try { dispose() } catch { /* ignore */ }
      }
    })
  })

  // ---------- 事件接线 ----------

  ctx.on('agent/created', (payload) => {
    pullAll().catch((error) => logger.error(`[aire-memory] 拉取异常: ${error?.message ?? error}`))
  })

  ctx.on('session/event', (session, event) => {
    state.sessions.set(session.id, session)
    if (event?.type === 'user/message' || event?.type === 'turn/start') {
      cancelScheduled(session.id)
    }
  })

  ctx.on('agent/turn-stopping', (payload) => {
    const session = state.sessions.get(payload?.agent?.id)
    if (!session || !isWritebackSession(session) || !effective('writebackEnabled')) return
    scheduleWriteback(session.id, effective('writebackDebounceMs'), payload?.turn)
  })

  ctx.on('agent/disposed', (payload) => {
    const session = state.sessions.get(payload?.agent?.id)
    if (!session || !isWritebackSession(session) || !effective('writebackEnabled')) return
    scheduleWriteback(session.id, 0, undefined)
  })

  ctx.on('session/disposed', (session) => {
    dropSessionIfIdle(session?.id)
  })

  ctx.on('dispose', () => {
    for (const timer of state.pending.values()) clearTimeout(timer)
    state.pending.clear()
  })

  // ---------- 启动热身：立即拉取一次，让当前会话也能立刻注入 ----------

  pullAll().catch((error) => logger.error(`[aire-memory] 启动拉取异常: ${error?.message ?? error}`))
}

export { buildTranscript, parseJsonLoose, scrubSecrets }

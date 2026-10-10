    // Layer: 原生设置页里的完整配置页面（settings.section）。
    function FieldRow(props) {
      return React.createElement('div', { className: 'am-row' },
        React.createElement('span', { className: 'am-label' }, props.label),
        props.children,
      )
    }

    function TextField(props) {
      return React.createElement('input', {
        className: 'am-input',
        type: props.type || 'text',
        value: props.value === undefined || props.value === null ? '' : String(props.value),
        placeholder: props.placeholder || '',
        onChange: function (event) { props.onChange(event.target.value) },
      })
    }

    function TextAreaField(props) {
      return React.createElement('textarea', {
        className: 'am-input am-textarea',
        rows: 3,
        value: props.value === undefined || props.value === null ? '' : String(props.value),
        placeholder: props.placeholder || '',
        onChange: function (event) { props.onChange(event.target.value) },
      })
    }

    function NumberField(props) {
      var min = props.min === undefined ? 1 : props.min
      var current = Number(props.value)
      var clamped = Number.isFinite(current) ? Math.max(min, Math.floor(current)) : min
      return React.createElement('div', { className: 'am-number-field' },
        React.createElement('button', {
          type: 'button',
          className: 'am-number-btn',
          disabled: clamped <= min,
          title: clamped <= min ? '最小就是 ' + min : '',
          onClick: function () { props.onChange(Math.max(min, clamped - 1)) },
        }, '−'),
        React.createElement('input', {
          className: 'am-input am-number-input',
          type: 'number',
          min: min,
          step: 1,
          value: props.value === undefined || props.value === null ? '' : String(props.value),
          onChange: function (event) {
            var raw = event.target.value
            var num = Number(raw)
            if (raw === '' || !Number.isFinite(num) || num < min) {
              // 输入非法时先不写回，失焦时 NumberField 的 value 仍受控；直接夹到最小
              if (raw === '') return
              props.onChange(min)
              return
            }
            props.onChange(Math.floor(num))
          },
          onBlur: function (event) {
            var num = Number(event.target.value)
            if (!Number.isFinite(num) || num < min) props.onChange(min)
          },
        }),
        React.createElement('button', {
          type: 'button',
          className: 'am-number-btn',
          onClick: function () { props.onChange(clamped + 1) },
        }, '+'),
      )
    }

    function SettingsPage() {
      var statePair = React.useState(null)
      var status = statePair[0]
      var setStatus = statePair[1]
      var busyPair = React.useState(false)
      var busy = busyPair[0]
      var setBusy = busyPair[1]
      var noticePair = React.useState('')
      var notice = noticePair[0]
      var setNotice = noticePair[1]

      var formPair = React.useState(null)
      var form = formPair[0]
      var setForm = formPair[1]
      var tokenDraftPair = React.useState('')
      var tokenDraft = tokenDraftPair[0]
      var setTokenDraft = tokenDraftPair[1]
      var repoListPair = React.useState(null) // { ok, count, repos: [{full_name, private}] } | null
      var repoList = repoListPair[0]
      var setRepoList = repoListPair[1]
      var latestVersionPair = React.useState(null)
      var latestVersion = latestVersionPair[0]
      var setLatestVersion = latestVersionPair[1]

      var loadRepos = function (silent) {
        fetchRepos().then(function (result) {
          setRepoList(result && result.ok ? result : { ok: false, error: (result && result.error) || '未知错误', repos: [] })
          if (!silent && result && !result.ok) flash('获取仓库列表失败：' + (result.error || '未知错误'))
        }, function (error) {
          setRepoList({ ok: false, error: String((error && error.message) || error), repos: [] })
          if (!silent) flash('获取仓库列表失败：' + String((error && error.message) || error))
        })
      }

      React.useEffect(function () {
        loadRepos(true)
      }, [])

      // 表单脏标记：只要用户动过任何字段，轮询就不再拿服务器值覆盖草稿
      var formRef = React.useRef(null)

      var refresh = function () {
        fetchStatus().then(function (next) {
          setStatus(next)
          if (next && next.settings && formRef.current === null) {
            var f = cloneForm(next.settings)
            formRef.current = f
            setForm(f)
          }
        }, function (error) {
          setStatus({ ok: false, error: String((error && error.message) || error) })
        })
      }

      React.useEffect(function () {
        refresh()
        var timer = setInterval(refresh, 8000)
        return function () { clearInterval(timer) }
      }, [])

      var flash = function (text, tone) {
        amToast(text, tone)
        setNotice(text)
        setTimeout(function () { setNotice('') }, 5000)
      }

      var setField = function (key, value) {
        setForm(function (current) {
          var next = Object.assign({}, current || {})
          next[key] = value
          formRef.current = next
          return next
        })
      }

      // ---- 文件权限中心 ----
      var fileSyncPair = React.useState(null)
      var fileSync = fileSyncPair[0]
      var setFileSync = fileSyncPair[1]

      var onSyncFiles = function () {
        if (busy) return
        setBusy(true)
        syncFiles().then(function (result) {
          setBusy(false)
          if (result && result.ok) {
            setFileSync({ files: result.files, removed: result.removed })
            flash('文件列表已同步（' + (result.files ? result.files.length : 0) + ' 个文件）')
          } else {
            flash('同步失败：' + ((result && result.message) || '未知错误'))
          }
        }, function (error) {
          setBusy(false)
          flash('同步失败：' + String((error && error.message) || error))
        })
      }

      var onToggleFileMode = function (file) {
        setFileSync(function (current) {
          if (!current) return current
          var files = (current.files || []).map(function (entry) {
            if (entry.file !== file) return entry
            return Object.assign({}, entry, { mode: entry.mode === 'rw' ? 'ro' : 'rw' })
          })
          return { files: files, removed: current.removed }
        })
      }

      var onApplyFileModes = function () {
        if (!fileSync) return
        setBusy(true)
        var modes = (fileSync.files || []).map(function (entry) { return { file: entry.file, mode: entry.mode } })
        saveFileModes(modes).then(function (result) {
          setBusy(false)
          if (result && result.ok) {
            flash('文件权限已应用（' + (result.applied || 0) + ' 个）')
            setTimeout(refresh, 600)
          } else {
            flash('应用失败：' + ((result && result.message) || '未知错误'))
          }
        }, function (error) {
          setBusy(false)
          flash('应用失败：' + String((error && error.message) || error))
        })
      }

      var onInitRepo = function () {
        if (busy) return
        setBusy(true)
        initRepo().then(function (result) {
          setBusy(false)
          if (result && result.ok && result.initOk) {
            flash('初始化成功！已创建 ' + result.created + '，开始使用吧')
            onSyncFiles()
            setTimeout(refresh, 600)
          } else {
            flash((result && result.message) || '初始化失败')
          }
        }, function (error) {
          setBusy(false)
          flash('初始化失败：' + String((error && error.message) || error))
        })
      }

      var onCheckUpdate = function () {
        if (busy) return
        setBusy(true)
        checkUpdate().then(function (meta) {
          setBusy(false)
          setLatestVersion(meta && meta.version ? meta.version : null)
          var current = status && status.version ? status.version : '未知'
          if (meta && meta.version && meta.version !== current) {
            flash('发现新版本 ' + meta.version + '（当前 ' + current + '）。更新命令：dsh plugin --profile web add dsh-get-memory@' + meta.version)
          } else if (meta && meta.version) {
            flash('已是最新版本 ' + meta.version)
          } else {
            flash('检查失败：没拿到版本信息')
          }
        }, function (error) {
          setBusy(false)
          flash('检查更新失败：' + String((error && error.message) || error))
        })
      }

      var onSave = function () {
        if (!form) return
        setBusy(true)
        var patch = {}
        patch.repo = String(form.repo || '').trim()
        patch.branch = String(form.branch || '').trim()
        patch.ledgerFile = String(form.ledgerFile || '').trim()
        patch.injectOrder = Number(form.injectOrder)
        patch.writebackEnabled = !!form.writebackEnabled
        patch.writebackDebounceMs = Number(form.writebackDebounceMs)
        patch.maxTranscriptChars = Number(form.maxTranscriptChars)
        patch.minConversationChars = Number(form.minConversationChars)
        patch.extractProvider = String(form.extractProvider || '').trim()
        patch.extractModel = String(form.extractModel || '').trim()
        patch.requestTimeoutMs = Number(form.requestTimeoutMs)
        patch.historyLimit = Number(form.historyLimit)
        patch.autoDiscoverFiles = !!form.autoDiscoverFiles
        patch.writebackEveryN = Math.max(1, Number(form.writebackEveryN) || 5)
        patch.sessionPolicyMode = form.sessionPolicyMode === 'exclude' || form.sessionPolicyMode === 'include' ? form.sessionPolicyMode : 'all'
        patch.sessionPolicyIds = String(form.sessionPolicyIds || '')
          .split('\n').map(function (line) { return line.trim() }).filter(Boolean)
        patch.showGlobalNotice = !!form.showGlobalNotice
        patch.showGlobalNoticeMode = form.showGlobalNoticeMode === 'persistent' ? 'persistent' : 'momentary'
        patch.sessionsEnabledByDefault = !!form.sessionsEnabledByDefault
        patch.maxWriteFiles = Math.max(1, Number(form.maxWriteFiles) || 5)
        updateConfig(patch).then(function (result) {
          setBusy(false)
          if (result && result.ok) {
            flash('设置已保存并生效')
            setTimeout(refresh, 600)
          } else {
            flash('保存失败：' + ((result && result.message) || '未知错误'))
          }
        }, function (error) {
          setBusy(false)
          flash('保存失败：' + String((error && error.message) || error))
        })
      }

      var onSaveToken = function () {
        var value = String(tokenDraft || '').trim()
        if (!value) { flash('先粘贴令牌再点保存'); return }
        setBusy(true)
        saveToken(value).then(function (result) {
          setBusy(false)
          if (result && result.ok) {
            setTokenDraft('')
            flash(result.verified ? '令牌已保存，仓库验证通过' : '令牌已保存，正在读取仓库列表…')
            loadRepos()
            setTimeout(refresh, 600)
          } else {
            flash('保存失败：' + ((result && result.message) || '未知错误'))
          }
        }, function (error) {
          setBusy(false)
          flash('保存失败：' + String((error && error.message) || error))
        })
      }

      var onPull = function () {
        if (busy) return
        setBusy(true)
        triggerPull().then(function (next) {
          setBusy(false)
          setStatus(next)
          flash(next && next.pullOk ? '拉取完成' : '拉取没有完全成功——多半是网络波动，稍后重试，已有记忆缓存不受影响 (´･ω･`)')
        }, function (error) {
          setBusy(false)
          flash('拉取失败：' + String((error && error.message) || error))
        })
      }

      if (!status) {
        return React.createElement('div', { className: 'am-panel' },
          React.createElement('div', { className: 'am-notice' }, '读取插件状态中…'),
        )
      }

      if (status.ok === false) {
        return React.createElement('div', { className: 'am-panel' },
          React.createElement('div', { className: 'am-notice' }, '无法读取插件状态：' + (status.error || '未知错误')),
        )
      }

      var token = status.token || { configured: false, source: null }
      var cache = status.cache
      var lastWriteback = status.lastWriteback

      return React.createElement('div', { className: 'am-panel am-settings' },
        React.createElement(GuideBanner),
        React.createElement(Card, { title: '状态' },
          React.createElement(Row, { label: '最近拉取' },
            React.createElement('span', { className: 'am-value' },
              cache ? formatTime(cache.fetchedAt) + (cache.stale ? '（部分过期）' : '') : '尚未拉取'),
          ),
          React.createElement(Row, { label: '最近写回' },
            React.createElement('span', { className: 'am-value' },
              lastWriteback
                ? formatTime(lastWriteback.at) + ' · ' + (lastWriteback.phase === 'committed' ? '已提交' : lastWriteback.phase === 'skipped' ? '跳过' : lastWriteback.phase === 'error' ? '失败' : lastWriteback.phase)
                : '—'),
          ),
          React.createElement(Row, { label: '操作' },
            React.createElement(Button, { primary: true, onClick: onPull, disabled: busy }, busy ? '处理中…' : '立即拉取'),
          ),
        ),

        React.createElement(Card, { title: '令牌' },
          React.createElement(Row, { label: '当前状态' },
            React.createElement('span', { className: 'am-value' },
              token.configured ? '已配置（' + tokenSourceLabel(token.source) + '）' : '未配置'),
          ),
          React.createElement('div', { className: 'am-row' },
            React.createElement('input', {
              className: 'am-input',
              type: 'password',
              placeholder: token.configured ? '留空保持不变，粘贴新令牌可替换' : '粘贴 GitHub 细颗粒度令牌（仅目标仓库 Contents 读写）',
              value: tokenDraft,
              onChange: function (event) { setTokenDraft(event.target.value) },
            }),
            React.createElement(Button, { primary: true, onClick: onSaveToken, disabled: busy }, '保存'),
          ),
          React.createElement('div', { className: 'am-notice' }, '令牌存入 DSH 凭据库，绝不写入记忆仓库'),
        ),

        React.createElement(Card, { title: '记忆仓库' },
          React.createElement(FieldRow, { label: '选择仓库' },
            React.createElement('select', {
              className: 'am-input',
              value: form ? form.repo : '',
              disabled: busy || !repoList,
              onChange: function (event) { setField('repo', event.target.value) },
            },
              React.createElement('option', { value: '' }, form && form.repo ? form.repo + '（当前）' : '— 选择一个仓库 —'),
              (repoList && repoList.repos ? repoList.repos : []).map(function (entry) {
                return React.createElement('option', { value: entry.full_name, key: entry.full_name },
                  entry.full_name + (entry.private ? '（私有）' : ''))
              }),
            ),
          ),
          React.createElement('div', { className: 'am-row' },
            React.createElement(Button, { onClick: function () { loadRepos(false) }, disabled: busy }, '刷新仓库列表'),
          ),
          React.createElement('div', { className: 'am-notice' },
            '仓库列表来自你保存的令牌：列表里出现的仓库才可读写。看不到目标仓库？去 GitHub 把令牌授权加到这个仓库上，再回来刷新。'),
          form && form.repo
            ? null
            : React.createElement('div', { className: 'am-notice' }, '还没选仓库：现在不会注入任何内容，也不会写回。'),
        ),

        React.createElement(Card, { title: '文件权限' },
          React.createElement(Row, { label: '同步仓库文件列表' },
            React.createElement(Button, { primary: true, onClick: onSyncFiles, disabled: busy }, busy ? '同步中…' : '同步文件列表'),
          ),
          fileSync && fileSync.files && fileSync.files.length === 0
            ? React.createElement('div', { className: 'am-row' },
                React.createElement(Button, { primary: true, onClick: onInitRepo, disabled: busy }, busy ? '初始化中…' : '一键初始化记忆仓库'),
              )
            : null,
          fileSync && fileSync.files && fileSync.files.length === 0
            ? React.createElement('div', { className: 'am-notice' },
                '这个仓库还没有记忆文件。点「一键初始化」，插件会用你的令牌自动创建一个 长期记忆账本.md，之后就能正常读写——不用你去 GitHub 手动建。')
            : null,
          fileSync && fileSync.files
            ? fileSync.files.map(function (entry) {
                return React.createElement(Row, { label: React.createElement(React.Fragment, null,
                  entry.file,
                  entry.isNew ? React.createElement('span', { className: 'am-notice', key: 'n' }, '（新）') : null,
                ) },
                  React.createElement('div', { className: 'am-row' },
                    React.createElement(Button, {
                      primary: entry.mode === 'rw',
                      onClick: function () { if (entry.mode !== 'rw') onToggleFileMode(entry.file) },
                    }, '读写'),
                    React.createElement(Button, {
                      primary: entry.mode === 'ro',
                      onClick: function () { if (entry.mode !== 'ro') onToggleFileMode(entry.file) },
                    }, '只读'),
                  ),
                )
              })
            : React.createElement('div', { className: 'am-empty' }, '点「同步文件列表」拉取仓库当前文件'),
          fileSync && fileSync.removed && fileSync.removed.length > 0
            ? React.createElement('div', { className: 'am-notice' }, '已删除（将从权限表移除）：' + fileSync.removed.join('、'))
            : null,
          fileSync && fileSync.files && fileSync.files.length > 0
            ? React.createElement(Row, { label: '应用以上权限' },
                React.createElement(Button, { primary: true, onClick: onApplyFileModes, disabled: busy }, '应用'),
              )
            : null,
          React.createElement('div', { className: 'am-notice' }, '「只读」仅注入上下文；「读写」在对话结束后也会作为写回目标（新文件默认读写）'),
        ),

        React.createElement(Card, { title: '写回与提取' },
          React.createElement(Row, { label: '自动写回' },
            React.createElement(Switch, {
              on: form ? !!form.writebackEnabled : false,
              onToggle: function () { setField('writebackEnabled', !(form && form.writebackEnabled)) },
              disabled: busy,
              title: '对话结束后自动提取新记忆并写回仓库（会消耗模型额度，默认关闭）',
            }),
          ),
          React.createElement('div', { className: 'am-notice' }, '开启后：回合结束并静止约 30 秒后开始写回；等待期内发送新消息会顺延。写回需调用模型并提交到仓库，通常耗时 1-3 分钟，期间输入框下方会常驻「记忆整理中…」提示。'),
        ),

        React.createElement(Card, { title: '触发与范围' },
          React.createElement(FieldRow, { label: '每多少条对话写回一次记忆' },
            React.createElement(NumberField, { value: form ? form.writebackEveryN : 5, onChange: function (v) { setField('writebackEveryN', v) } }),
          ),
          React.createElement('div', { className: 'am-notice' }, '填 1 = 每条对话结束后都写回；填 5 = 攒够 5 条才写一次。数字越大越省模型额度。'),
          React.createElement(FieldRow, { label: '应用于会话' },
            React.createElement('select', {
              className: 'am-input',
              value: form ? form.sessionPolicyMode : 'all',
              onChange: function (event) { setField('sessionPolicyMode', event.target.value) },
            },
              React.createElement('option', { value: 'all' }, '全部会话'),
              React.createElement('option', { value: 'exclude' }, '排除以下会话'),
              React.createElement('option', { value: 'include' }, '仅以下会话'),
            ),
          ),
          form && form.sessionPolicyMode !== 'all'
            ? React.createElement(React.Fragment, null,
                React.createElement(FieldRow, { label: '会话 ID（每行一个）' },
                  React.createElement(TextAreaField, {
                    value: form.sessionPolicyIds,
                    placeholder: '粘贴会话 ID，每行一个',
                    onChange: function (v) { setField('sessionPolicyIds', v) },
                  }),
                ),
                React.createElement('div', { className: 'am-notice' }, '会话 ID 是每个对话窗口的「门牌号」。去左侧会话列表，点那一行的「⋯」→「复制会话 ID」，回来粘贴即可；只填一段也能模糊匹配。'),
              )
            : null,
          React.createElement(Row, { label: '写回变动全局提示' },
            React.createElement(Switch, {
              on: form ? form.showGlobalNotice !== false : true,
              onToggle: function () { setField('showGlobalNotice', form ? form.showGlobalNotice === false : false) },
              disabled: busy,
              title: '输入框下方全程提示：整理中（常驻）→ 已更新 / 无新记忆 / 失败',
            }),
          ),
          React.createElement(FieldRow, { label: '胶囊显示方式' },
            React.createElement('select', {
              className: 'am-input',
              value: form ? (form.showGlobalNoticeMode === 'momentary' ? 'momentary' : 'persistent') : 'persistent',
              onChange: function (event) { setField('showGlobalNoticeMode', event.target.value) },
            },
              React.createElement('option', { value: 'momentary' }, '仅变动后临时显示'),
              React.createElement('option', { value: 'persistent' }, '长期显示最近状态'),
            ),
          ),
          React.createElement('div', { className: 'am-notice' }, '临时 = 弹几秒就消失；长期 = 「记忆已更新 / 无新记忆」小胶囊一直挂到下次变化。'),
          React.createElement(Row, { label: '新建对话默认使用 Get记忆' },
            React.createElement(Switch, {
              on: form ? form.sessionsEnabledByDefault !== false : true,
              onToggle: function () { setField('sessionsEnabledByDefault', form ? form.sessionsEnabledByDefault === false : false) },
              disabled: busy,
              title: '关闭后，新建对话默认暂停写回（每个窗口输入框下方可单独再开）',
            }),
          ),
        ),

        React.createElement(Card, { title: '其他' },
          React.createElement(Row, { label: '自动发现新文件' },
            React.createElement(Switch, {
              on: form ? form.autoDiscoverFiles !== false : true,
              onToggle: function () { setField('autoDiscoverFiles', form ? form.autoDiscoverFiles === false : false) },
              disabled: busy,
              title: '每次拉取时把仓库根目录新出现的 .md 文件自动加入注入列表',
            }),
          ),
          React.createElement(Row, { label: '版本' },
            React.createElement('span', { className: 'am-value' },
              '当前 ' + (status && status.version ? status.version : '未知')
              + (latestVersion ? '　·　npm 最新 ' + latestVersion : ''),
            ),
          ),
          React.createElement(Row, { label: '检查更新' },
            React.createElement(Button, { onClick: onCheckUpdate, disabled: busy }, busy ? '检查中…' : '检查更新'),
          ),
          React.createElement('div', { className: 'am-notice' }, '更新方式：`dsh plugin --profile web add dsh-get-memory@最新版本号`'),
        ),

        React.createElement(Card, { title: '关于 Get记忆' },
          React.createElement('div', { className: 'am-row' },
            React.createElement('a', { className: 'am-link', href: 'https://github.com/krodon998/dsh-get-memory', target: '_blank', rel: 'noreferrer' }, 'GitHub 仓库'),
            React.createElement('a', { className: 'am-link', href: 'https://github.com/krodon998/dsh-get-memory/issues', target: '_blank', rel: 'noreferrer' }, '问题反馈'),
            React.createElement(GuideLauncher),
          ),
          React.createElement('details', { className: 'am-changelog' },
            React.createElement('summary', null, '更新记录'),
            React.createElement('div', { className: 'am-changelog-body' }, [
              ['v0.5.0', '设置引导、本窗口记忆开关、胶囊常显/临时模式、拉取404自动清理、文案易读化'],
              ['v0.4.2', '注入绑定声明（代入感兜底）'],
              ['v0.4.1', '一键初始化空仓库、设置页检查更新'],
              ['v0.4.0', '令牌驱动仓库选择器、安全默认（空仓库不注入、写回默认关）'],
              ['v0.3.x', '文件权限中心、多文件写回、触发与范围、全局提示胶囊'],
            ].map(function (entry) {
              return React.createElement('div', { className: 'am-changelog-row', key: entry[0] },
                React.createElement('span', { className: 'am-changelog-ver' }, entry[0]),
                React.createElement('span', null, entry[1]),
              )
            })),
          ),
        ),

        React.createElement('div', { className: 'am-save-bar' },
          React.createElement('span', { className: 'am-save-hint' }, '有改动记得保存，否则不生效'),
          React.createElement(Button, { primary: true, onClick: onSave, disabled: busy || !form }, busy ? '保存中…' : '保存全部设置'),
        ),
        notice ? React.createElement('div', { className: 'am-notice' }, notice) : null,
      )
    }

    function cloneForm(settings) {
      return {
        repo: settings.repo,
        branch: settings.branch,
        ledgerFile: settings.ledgerFile,
        injectOrder: settings.injectOrder,
        writebackEnabled: settings.writebackEnabled,
        writebackDebounceMs: settings.writebackDebounceMs,
        maxTranscriptChars: settings.maxTranscriptChars,
        minConversationChars: settings.minConversationChars,
        extractProvider: settings.extractProvider,
        extractModel: settings.extractModel,
        requestTimeoutMs: settings.requestTimeoutMs,
        historyLimit: settings.historyLimit,
        autoDiscoverFiles: settings.autoDiscoverFiles,
        writebackEveryN: settings.writebackEveryN,
        sessionPolicyMode: settings.sessionPolicyMode,
        sessionPolicyIds: Array.isArray(settings.sessionPolicyIds) ? settings.sessionPolicyIds.join('\n') : '',
        showGlobalNotice: settings.showGlobalNotice,
        showGlobalNoticeMode: settings.showGlobalNoticeMode === 'momentary' ? 'momentary' : 'persistent',
        sessionsEnabledByDefault: settings.sessionsEnabledByDefault,
        maxWriteFiles: settings.maxWriteFiles,
      }
    }

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
      return React.createElement('input', {
        className: 'am-input',
        type: 'number',
        value: props.value === undefined || props.value === null ? '' : String(props.value),
        onChange: function (event) { props.onChange(Number(event.target.value)) },
      })
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

      var refresh = function () {
        fetchStatus().then(function (next) {
          setStatus(next)
          if (next && next.settings && form === null) setForm(cloneForm(next.settings))
        }, function (error) {
          setStatus({ ok: false, error: String((error && error.message) || error) })
        })
      }

      React.useEffect(function () {
        refresh()
        var timer = setInterval(refresh, 8000)
        return function () { clearInterval(timer) }
      }, [])

      var flash = function (text) {
        setNotice(text)
        setTimeout(function () { setNotice('') }, 5000)
      }

      var setField = function (key, value) {
        setForm(function (current) {
          var next = Object.assign({}, current || {})
          next[key] = value
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
        patch.writebackEveryN = Math.max(1, Number(form.writebackEveryN) || 1)
        patch.sessionPolicyMode = form.sessionPolicyMode === 'exclude' || form.sessionPolicyMode === 'include' ? form.sessionPolicyMode : 'all'
        patch.sessionPolicyIds = String(form.sessionPolicyIds || '')
          .split('\n').map(function (line) { return line.trim() }).filter(Boolean)
        patch.showGlobalNotice = !!form.showGlobalNotice
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
            flash(result.verified ? '令牌已保存，仓库验证通过' : '令牌已保存，但仓库验证失败：' + (result.verifyMessage || ''))
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
          flash(next && next.pullOk ? '拉取完成' : '拉取没有完全成功，看状态卡片')
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
          React.createElement(FieldRow, { label: '仓库（owner/repo）' },
            React.createElement(TextField, { value: form ? form.repo : '', onChange: function (v) { setField('repo', v) } }),
          ),
          React.createElement(FieldRow, { label: '分支' },
            React.createElement(TextField, { value: form ? form.branch : '', onChange: function (v) { setField('branch', v) } }),
          ),
          React.createElement(FieldRow, { label: '主账本文件' },
            React.createElement(TextField, { value: form ? form.ledgerFile : '', onChange: function (v) { setField('ledgerFile', v) } }),
          ),
        ),

        React.createElement(Card, { title: '文件权限' },
          React.createElement(Row, { label: '同步仓库文件列表' },
            React.createElement(Button, { primary: true, onClick: onSyncFiles, disabled: busy }, busy ? '同步中…' : '同步文件列表'),
          ),
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
            }),
          ),
          React.createElement(FieldRow, { label: '写回防抖（毫秒）' },
            React.createElement(NumberField, { value: form ? form.writebackDebounceMs : 0, onChange: function (v) { setField('writebackDebounceMs', v) } }),
          ),
          React.createElement(FieldRow, { label: '转录上限（字符）' },
            React.createElement(NumberField, { value: form ? form.maxTranscriptChars : 0, onChange: function (v) { setField('maxTranscriptChars', v) } }),
          ),
          React.createElement(FieldRow, { label: '最低转录长度' },
            React.createElement(NumberField, { value: form ? form.minConversationChars : 0, onChange: function (v) { setField('minConversationChars', v) } }),
          ),
          React.createElement(FieldRow, { label: '提取模型 provider' },
            React.createElement(TextField, { value: form ? form.extractProvider : '', placeholder: '留空用会话模型', onChange: function (v) { setField('extractProvider', v) } }),
          ),
          React.createElement(FieldRow, { label: '提取模型 model' },
            React.createElement(TextField, { value: form ? form.extractModel : '', placeholder: '留空用会话模型', onChange: function (v) { setField('extractModel', v) } }),
          ),
        ),

        React.createElement(Card, { title: '触发与范围' },
          React.createElement(FieldRow, { label: '每 N 次对话写回' },
            React.createElement(NumberField, { value: form ? form.writebackEveryN : 1, onChange: function (v) { setField('writebackEveryN', v) } }),
          ),
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
            ? React.createElement(FieldRow, { label: '会话 ID（每行一个）' },
                React.createElement(TextAreaField, {
                  value: form.sessionPolicyIds,
                  placeholder: '粘贴会话 ID，每行一个',
                  onChange: function (v) { setField('sessionPolicyIds', v) },
                }),
              )
            : null,
          React.createElement(Row, { label: '写回变动全局提示' },
            React.createElement(Switch, {
              on: form ? form.showGlobalNotice !== false : true,
              onToggle: function () { setField('showGlobalNotice', form ? form.showGlobalNotice === false : false) },
              disabled: busy,
              title: '写回有变动时在输入框上方显示小条提示',
            }),
          ),
          React.createElement(FieldRow, { label: '每次写回最多文件数' },
            React.createElement(NumberField, { value: form ? form.maxWriteFiles : 5, onChange: function (v) { setField('maxWriteFiles', v) } }),
          ),
        ),

        React.createElement(Card, { title: '其他' },
          React.createElement(FieldRow, { label: '注入排序号' },
            React.createElement(NumberField, { value: form ? form.injectOrder : 100, onChange: function (v) { setField('injectOrder', v) } }),
          ),
          React.createElement(FieldRow, { label: '请求超时（毫秒）' },
            React.createElement(NumberField, { value: form ? form.requestTimeoutMs : 15000, onChange: function (v) { setField('requestTimeoutMs', v) } }),
          ),
          React.createElement(FieldRow, { label: '记录保留条数' },
            React.createElement(NumberField, { value: form ? form.historyLimit : 50, onChange: function (v) { setField('historyLimit', v) } }),
          ),
          React.createElement(Row, { label: '自动发现新文件' },
            React.createElement(Switch, {
              on: form ? form.autoDiscoverFiles !== false : true,
              onToggle: function () { setField('autoDiscoverFiles', form ? form.autoDiscoverFiles === false : false) },
              disabled: busy,
              title: '每次拉取时把仓库根目录新出现的 .md 文件自动加入注入列表',
            }),
          ),
        ),

        React.createElement('div', { className: 'am-row' },
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
        maxWriteFiles: settings.maxWriteFiles,
      }
    }

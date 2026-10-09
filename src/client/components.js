    // Layer: panel icon and the main Aire 记忆 panel.
    function AireIcon(props) {
      var size = props && props.size ? props.size : 20
      var active = !!(props && props.active)
      return React.createElement(
        'svg',
        {
          width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
          'aria-hidden': 'true',
        },
        React.createElement('path', {
          d: 'M12 21s-7.5-4.6-9.7-9.3C.7 8.3 2.7 4.5 6.3 4.5c2.2 0 3.7 1.2 5.7 3.4 2-2.2 3.5-3.4 5.7-3.4 3.6 0 5.6 3.8 4 7.2C19.5 16.4 12 21 12 21z',
          fill: active ? 'currentColor' : 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinejoin: 'round',
          opacity: active ? 1 : 0.75,
        }),
      )
    }

    function StatusDot(props) {
      return React.createElement('span', { className: 'am-dot ' + statusTone(props.status) })
    }

    function Card(props) {
      return React.createElement('div', { className: 'am-card' },
        React.createElement('div', { className: 'am-title' }, props.title),
        props.children,
      )
    }

    function Row(props) {
      return React.createElement('div', { className: 'am-row' },
        React.createElement('span', { className: 'am-label' }, props.label),
        props.children,
      )
    }

    function Switch(props) {
      return React.createElement('button', {
        type: 'button',
        className: 'am-switch' + (props.on ? ' on' : ''),
        'aria-pressed': !!props.on,
        title: props.title,
        onClick: props.onToggle,
        disabled: props.disabled,
      })
    }

    function Button(props) {
      return React.createElement('button', {
        type: 'button',
        className: 'am-button' + (props.primary ? ' primary' : ''),
        onClick: props.onClick,
        disabled: props.disabled,
      }, props.children)
    }

    function HistoryList(props) {
      var history = props.history
      if (!Array.isArray(history) || history.length === 0) {
        return React.createElement('div', { className: 'am-empty' }, '还没有操作记录')
      }
      return React.createElement('div', { className: 'am-history' },
        history.map(function (entry, index) {
          var kindLabel = entry.kind === 'pull' ? '拉取'
            : entry.kind === 'writeback' ? '写回'
            : entry.kind === 'config' ? '配置'
            : entry.kind === 'token' ? '令牌'
            : entry.kind === 'discover' ? '发现'
            : String(entry.kind || '记录')
          return React.createElement('div', { className: 'am-history-item', key: index },
            React.createElement('span', { className: 'am-history-time' }, formatTime(entry.at)),
            React.createElement('span', { className: 'am-history-kind' }, kindLabel),
            React.createElement(StatusDot, { status: statusTone(entry.status) }),
            React.createElement('span', null, entry.message || ''),
          )
        }),
      )
    }

    function MemoryPanel() {
      var statePair = React.useState(null)
      var status = statePair[0]
      var setStatus = statePair[1]
      var busyPair = React.useState(false)
      var busy = busyPair[0]
      var setBusy = busyPair[1]
      var noticePair = React.useState('')
      var notice = noticePair[0]
      var setNotice = noticePair[1]
      var draftPair = React.useState('')
      var draft = draftPair[0]
      var setDraft = draftPair[1]

      var refresh = function () {
        fetchStatus().then(setStatus, function (error) {
          setStatus({ ok: false, error: String((error && error.message) || error) })
        })
      }

      React.useEffect(function () {
        refresh()
        var timer = setInterval(refresh, 5000)
        return function () { clearInterval(timer) }
      }, [])

      var flash = function (text) {
        setNotice(text)
        setTimeout(function () { setNotice('') }, 4000)
      }

      var onPull = function () {
        if (busy) return
        setBusy(true)
        triggerPull().then(function (next) {
          setStatus(next)
          setBusy(false)
          flash(next && next.pullOk ? '拉取完成' : '拉取没有完全成功，看状态卡片')
        }, function (error) {
          setBusy(false)
          flash('拉取失败：' + String((error && error.message) || error))
        })
      }

      var onSaveToken = function () {
        var value = String(draft || '').trim()
        if (!value) { flash('先粘贴令牌再点保存'); return }
        setBusy(true)
        saveToken(value).then(function (result) {
          setBusy(false)
          if (result && result.ok) {
            setDraft('')
            if (result.verified) {
              flash('令牌已保存，仓库验证通过')
            } else {
              flash('令牌已保存，但仓库验证失败：' + (result.verifyMessage || '未知原因'))
            }
          } else {
            flash('保存失败：' + ((result && result.message) || '未知错误'))
          }
          setTimeout(refresh, 600)
        }, function (error) {
          setBusy(false)
          flash('保存失败：' + String((error && error.message) || error))
        })
      }

      var onToggleWriteback = function () {
        var current = !!(status && status.writebackEnabled)
        setBusy(true)
        updateConfig({ writebackEnabled: !current }).then(function (result) {
          setBusy(false)
          if (result && result.ok) {
            flash(!current ? '自动写回已开启' : '自动写回已关闭')
            setTimeout(refresh, 800)
          } else {
            flash('切换失败：' + ((result && result.message) || '未知错误'))
          }
        }, function (error) {
          setBusy(false)
          flash('切换失败：' + String((error && error.message) || error))
        })
      }

      if (status && status.ok === false) {
        return React.createElement('div', { className: 'am-panel' },
          React.createElement(Card, { title: 'Get记忆' },
            React.createElement('div', { className: 'am-notice' }, '无法读取插件状态：' + (status.error || '未知错误')),
          ),
        )
      }

      var token = (status && status.token) || { configured: false, source: null }
      var cache = status && status.cache
      var lastWriteback = status && status.lastWriteback

      return React.createElement('div', { className: 'am-panel' },
        React.createElement(Card, { title: React.createElement(React.Fragment, null,
          React.createElement(AireIcon, { size: 16 }),
          'Get记忆 · ' + ((status && status.repo) || ''),
          status && status.ok ? React.createElement('span', { className: 'am-pulse', title: '插件在线' }) : null,
        ) },
          React.createElement(Row, { label: '记忆仓库' },
            React.createElement('span', { className: 'am-value' },
              status ? (status.repo + '@' + status.branch) : '…'),
          ),
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
          React.createElement(Row, { label: '自动写回' },
            React.createElement(Switch, {
              on: !!status && !!status.writebackEnabled,
              onToggle: onToggleWriteback,
              disabled: busy || !status,
              title: '对话结束自动提取记忆写回仓库',
            }),
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
              placeholder: token.configured ? '留空保持不变，粘贴新令牌可替换' : '粘贴 GitHub 细颗粒度令牌（仅本仓库 Contents 读写）',
              value: draft,
              onChange: function (event) { setDraft(event.target.value) },
            }),
            React.createElement(Button, { primary: true, onClick: onSaveToken, disabled: busy }, '保存'),
          ),
          React.createElement('div', { className: 'am-notice' }, '令牌存入 DSH 凭据库，绝不写入记忆仓库'),
        ),

        React.createElement(Card, { title: '操作' },
          React.createElement(Row, { label: '立刻从仓库拉取最新记忆' },
            React.createElement(Button, { primary: true, onClick: onPull, disabled: busy }, busy ? '处理中…' : '立即拉取'),
          ),
          React.createElement(Row, { label: '完整配置' },
            React.createElement('span', { className: 'am-notice' }, '打开 DSH 设置 → 「Get记忆」页面，仓库、文件、防抖时长等全部字段都能在那里调整'),
          ),
        ),

        React.createElement(Card, { title: '最近记录' },
          React.createElement(HistoryList, { history: status && status.history }),
        ),

        notice
          ? React.createElement('div', { className: 'am-notice' }, notice)
          : null,
      )
    }

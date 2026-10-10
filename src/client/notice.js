    // Layer: 全局提示——写回全程可见：进行中常驻「记忆整理中…」，成功后按模式显示「记忆已更新」。
    // showGlobalNoticeMode: 'momentary' = 变动后临时显示几秒；'persistent' = 常驻显示最近状态直到下次变化。
    function GlobalMemoryNotice() {
      var statePair = React.useState(null) // { kind: 'progress' | 'done' | 'error' | 'skip', text: string }
      var state = statePair[0]
      var setState = statePair[1]
      var lastSeenPair = React.useRef(null)
      var modeRef = React.useRef('momentary')

      React.useEffect(function () {
        var alive = true
        var hideTimer = null
        var scheduleHide = function (ms) {
          if (modeRef.current === 'persistent') return // 常显模式：不自动消失
          if (hideTimer) clearTimeout(hideTimer)
          hideTimer = setTimeout(function () { if (alive) setState(null) }, ms)
        }
        var poll = function () {
          fetchStatus().then(function (status) {
            if (!alive || !status || status.ok === false) return
            if (status.settings && status.settings.showGlobalNotice === false) {
              setState(null)
              return
            }
            modeRef.current = status.settings && status.settings.showGlobalNoticeMode === 'persistent' ? 'persistent' : 'momentary'
            var wb = status.lastWriteback
            if (!wb || !wb.phase) {
              setState(null)
              return
            }
            if (wb.phase === 'attempt') {
              if (hideTimer) clearTimeout(hideTimer)
              setState({ kind: 'progress', text: '记忆整理中…' })
              return
            }
            if (wb.phase === 'committed' && wb.at) {
              if (lastSeenPair.current !== wb.at) {
                lastSeenPair.current = wb.at
                setState({ kind: 'done', text: wb.summary || '记忆已更新' })
                scheduleHide(12000)
              }
              return
            }
            if (wb.phase === 'error') {
              if (lastSeenPair.current !== 'err:' + wb.at) {
                lastSeenPair.current = 'err:' + wb.at
                setState({ kind: 'error', text: '记忆写回失败' })
                scheduleHide(8000)
              }
              return
            }
            if (wb.phase === 'skipped' && wb.at) {
              if (lastSeenPair.current !== 'skip:' + wb.at) {
                lastSeenPair.current = 'skip:' + wb.at
                var skipText = wb.reason === 'transcript-too-short' ? '对话太短，已跳过'
                  : wb.reason === 'every-n' ? '本轮跳过（每 ' + (status.settings && status.settings.writebackEveryN ? status.settings.writebackEveryN : 5) + ' 条对话写回一次）'
                  : '无新记忆'
                setState({ kind: 'skip', text: skipText })
                scheduleHide(8000)
              }
              return
            }
            setState(null)
          }, function () { /* 网络抖动忽略 */ })
        }
        poll()
        var interval = setInterval(poll, 3000)
        return function () {
          alive = false
          clearInterval(interval)
          if (hideTimer) clearTimeout(hideTimer)
        }
      }, [])

      if (!state) return null
      var tone = state.kind === 'done' ? 'ok' : state.kind === 'error' ? 'error' : state.kind === 'skip' ? 'skip' : 'warn'
      var className = 'am-global-notice'
      if (state.kind === 'progress') className += ' am-notice-progress'
      var dot = state.kind === 'progress'
        ? React.createElement('span', { className: 'am-pulse-dot' })
        : React.createElement(StatusDot, { status: tone })
      return React.createElement('div', { className: className, role: 'status' },
        dot,
        React.createElement('span', null, state.text),
      )
    }

    // Layer: 输入框下方 Dock——本窗口开关 + 全局提示胶囊。
    function DockMemoryControl(props) {
      var session = props && props.sessionId ? String(props.sessionId) : ''
      var enabledPair = React.useState(null)
      var enabled = enabledPair[0]
      var setEnabled = enabledPair[1]

      React.useEffect(function () {
        var alive = true
        fetchSessionEnabled(session).then(function (result) {
          if (alive && result && result.ok) setEnabled(!!result.enabled)
        }, function () { /* 忽略 */ })
        return function () { alive = false }
      }, [session])

      var toggle = function () {
        var next = !enabled
        setEnabled(next)
        setSessionEnabled(session, next).then(function (result) {
          if (result && result.ok) setEnabled(!!result.enabled)
        }, function () { /* 失败恢复原样 */
          fetchSessionEnabled(session).then(function (r) { if (r && r.ok) setEnabled(!!r.enabled) })
        })
      }

      return React.createElement('div', { className: 'am-dock-control' },
        React.createElement('div', { className: 'am-dock-pill' },
          React.createElement('button', {
            type: 'button',
            className: 'am-session-toggle' + (enabled ? ' am-on' : ''),
            onClick: toggle,
            title: enabled ? '本窗口正在使用 Get记忆（点击关闭写回）' : '本窗口已暂停写回记忆（点击开启）',
          }, '记忆' + (enabled === null ? '' : enabled ? ' ✓' : ' ✕')),
          React.createElement(GlobalMemoryNotice),
        ),
      )
    }

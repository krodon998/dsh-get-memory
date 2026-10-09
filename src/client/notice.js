    // Layer: 全局提示——写回全程可见：进行中常驻「记忆整理中…」，成功后短暂显示「记忆已更新」。
    function GlobalMemoryNotice() {
      var statePair = React.useState(null) // { kind: 'progress' | 'done' | 'error', text: string }
      var state = statePair[0]
      var setState = statePair[1]
      var lastSeenPair = React.useRef(null)

      React.useEffect(function () {
        var alive = true
        var hideTimer = null
        var poll = function () {
          fetchStatus().then(function (status) {
            if (!alive || !status || status.ok === false) return
            if (status.settings && status.settings.showGlobalNotice === false) {
              setState(null)
              return
            }
            var wb = status.lastWriteback
            if (!wb || !wb.phase) {
              setState(null)
              return
            }
            if (wb.phase === 'attempt') {
              // 写回进行中：常驻提示，直到状态变化
              if (hideTimer) clearTimeout(hideTimer)
              setState({ kind: 'progress', text: '记忆整理中…' })
              return
            }
            if (wb.phase === 'committed' && wb.at) {
              if (lastSeenPair.current !== wb.at) {
                lastSeenPair.current = wb.at
                setState({ kind: 'done', text: wb.summary || '记忆已更新' })
                if (hideTimer) clearTimeout(hideTimer)
                hideTimer = setTimeout(function () { if (alive) setState(null) }, 12000)
              }
              return
            }
            if (wb.phase === 'error') {
              if (lastSeenPair.current !== 'err:' + wb.at) {
                lastSeenPair.current = 'err:' + wb.at
                setState({ kind: 'error', text: '记忆写回失败' })
                if (hideTimer) clearTimeout(hideTimer)
                hideTimer = setTimeout(function () { if (alive) setState(null) }, 8000)
              }
              return
            }
            if (wb.phase === 'skipped' && wb.at) {
              if (lastSeenPair.current !== 'skip:' + wb.at) {
                lastSeenPair.current = 'skip:' + wb.at
                var skipText = wb.reason === 'transcript-too-short' ? '对话太短，已跳过'
                  : wb.reason === 'every-n' ? '本轮跳过（每 N 次写回）'
                  : '无新记忆'
                setState({ kind: 'skip', text: skipText })
                if (hideTimer) clearTimeout(hideTimer)
                hideTimer = setTimeout(function () { if (alive) setState(null) }, 8000)
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

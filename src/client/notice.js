    // Layer: 全局提示——写回有变动时在输入框下方显示小条（几秒后消失，简洁模式也可见）。
    function GlobalMemoryNotice() {
      var shownPair = React.useState(null)
      var shown = shownPair[0]
      var setShown = shownPair[1]
      var lastSeenPair = React.useRef(null)

      React.useEffect(function () {
        var alive = true
        var hideTimer = null
        var poll = function () {
          fetchStatus().then(function (status) {
            if (!alive || !status || status.ok === false) return
            if (status.settings && status.settings.showGlobalNotice === false) {
              setShown(null)
              return
            }
            var wb = status.lastWriteback
            if (wb && wb.phase === 'committed' && wb.at) {
              if (lastSeenPair.current !== wb.at) {
                lastSeenPair.current = wb.at
                setShown(wb.summary || '记忆已更新')
                if (hideTimer) clearTimeout(hideTimer)
                hideTimer = setTimeout(function () { if (alive) setShown(null) }, 12000)
              }
            }
          }, function () { /* 网络抖动忽略 */ })
        }
        poll()
        var interval = setInterval(poll, 5000)
        return function () {
          alive = false
          clearInterval(interval)
          if (hideTimer) clearTimeout(hideTimer)
        }
      }, [])

      if (!shown) return null
      return React.createElement('div', { className: 'am-global-notice', role: 'status' },
        React.createElement(StatusDot, { status: 'ok' }),
        React.createElement('span', null, shown),
      )
    }

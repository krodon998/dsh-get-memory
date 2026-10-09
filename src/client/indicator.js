    // Layer: 每回合结束处的记忆写回指示（conversation.chat.turnTail）。
    var INDICATOR_TIMEOUT_MS = 90000
    var INDICATOR_POLL_MS = 3000

    function fetchWriteback(sessionId, turn, seq) {
      var params = new URLSearchParams()
      params.set('session', String(sessionId === undefined || sessionId === null ? '' : sessionId))
      if (turn !== undefined && turn !== null) params.set('turn', String(turn))
      if (seq !== undefined && seq !== null) params.set('seq', String(seq))
      return fetchJson(WRITEBACK_URL + '?' + params.toString())
    }

    function TurnMemoryIndicator(props) {
      var sessionId = props && props.sessionId
      var turnProp = props && props.turn
      var turn = (typeof turnProp === 'object' && turnProp !== null) ? turnProp.turn : turnProp
      var seq = props && props.seq

      var recordPair = React.useState(null)
      var record = recordPair[0]
      var setRecord = recordPair[1]
      var livePair = React.useState(true)
      var live = livePair[0]
      var setLive = livePair[1]

      React.useEffect(function () {
        var stop = false
        var settled = false
        var started = Date.now()

        var check = function () {
          if (stop) return
          fetchWriteback(sessionId, turn, seq).then(function (data) {
            if (stop) return
            if (data && data.found === true && data.record) {
              setRecord(data.record)
              if (data.record.phase === 'committed' || data.record.phase === 'skipped' || data.record.phase === 'error') {
                settled = true
              }
            } else if (Date.now() - started > INDICATOR_TIMEOUT_MS) {
              setLive(false)
            }
          }, function () {
            if (Date.now() - started > INDICATOR_TIMEOUT_MS) setLive(false)
          })
        }

        check()
        var timer = setInterval(function () {
          if (stop || settled) return
          if (Date.now() - started > INDICATOR_TIMEOUT_MS) { setLive(false); return }
          check()
        }, INDICATOR_POLL_MS)

        return function () {
          stop = true
          clearInterval(timer)
        }
      }, [sessionId, turn, seq])

      if (!live || !record) return null

      var text = null
      var tone = null
      if (record.phase === 'attempt') { text = '记忆整理中…'; tone = 'warn' }
      else if (record.phase === 'committed') { text = '记忆已写回 ✓'; tone = 'ok' }
      else if (record.phase === 'skipped') { text = '无新记忆'; tone = 'skip' }
      else if (record.phase === 'error') { text = '记忆写回失败'; tone = 'error' }
      if (text === null) return null

      var detail = record.summary || record.message || ''
      return React.createElement('div', {
        className: 'am-indicator',
        title: detail,
      },
        React.createElement(StatusDot, { status: tone }),
        React.createElement('span', null, 'Get记忆 · ' + text),
      )
    }

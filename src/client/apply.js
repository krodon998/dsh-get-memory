    // Layer: mount the right-rail icon, the main panel, the Plugins-page row config page, and package styles; all reversible.
    var name = 'dsh-aire-memory'
    var inject = ['slots']

    // 顶部提醒气泡：挂到 body 上（全局唯一），操作反馈统一从这里弹出。
    var ToastReactDOM = null
    try { ToastReactDOM = require('react-dom') } catch { ToastReactDOM = null }
    var toastRootEl = null
    function mountToastHost() {
      if (toastRootEl && document.body && document.body.contains(toastRootEl)) return
      try {
        toastRootEl = document.createElement('div')
        toastRootEl.id = 'am-toast-root'
        document.body.appendChild(toastRootEl)
        if (ToastReactDOM && typeof ToastReactDOM.createRoot === 'function') {
          ToastReactDOM.createRoot(toastRootEl).render(React.createElement(ToastHost))
        } else if (ToastReactDOM && typeof ToastReactDOM.render === 'function') {
          ToastReactDOM.render(React.createElement(ToastHost), toastRootEl)
        }
      } catch { toastRootEl = null }
    }

    function apply(ctx, config) {
      var slots = ctx.get('slots')
      if (slots === undefined || React === undefined) return

      ctx.effect(installStyles, 'aire-memory: styles')
      ctx.effect(mountToastHost, 'aire-memory: toast host')

      // 全局提示 + 本窗口开关：输入框下方（conversation.composer.dock）
      ctx.effect(function () {
        return slots.inject('conversation.composer.dock', function () {
          return slots.register(
            { name: 'conversation.composer.dock', id: 'aire-memory-notice', order: 20, label: 'Get记忆' },
            function AireDockControl(props) {
              return React.createElement(DockMemoryControl, props)
            },
          )
        })
      }, 'aire-memory: global notice')

      // 会话列表「⋯」菜单：复制会话 ID（配合设置页「应用于会话」）
      ctx.effect(function () {
        return slots.inject('sidebar.workspaces.session.menu.item', function () {
          return slots.register(
            { name: 'sidebar.workspaces.session.menu.item', id: 'dsh-get-memory-copy-session-id', order: 450 },
            function CopySessionIdMenuItem(props) {
              var useMenuOpenState = props && typeof props.useMenuOpenState === 'function' ? props.useMenuOpenState : null
              var setMenuOpen = useMenuOpenState ? useMenuOpenState()[1] : null
              var onSelect = function () {
                if (setMenuOpen) setMenuOpen(false)
                var id = String((props && props.sessionId) || '')
                var toast = function () { amToast(id ? '已复制会话 ID：' + id : '这个会话暂时没有 ID') }
                try {
                  if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(id).then(toast, function () {
                      try { window.prompt('复制下面这串会话 ID：', id) } catch { /* 忽略 */ }
                      toast()
                    })
                  } else {
                    try { window.prompt('复制下面这串会话 ID：', id) } catch { /* 忽略 */ }
                    toast()
                  }
                } catch { toast() }
              }
              return React.createElement('button', {
                type: 'button',
                role: 'menuitem',
                className: 'am-menu-item',
                onClick: onSelect,
                title: '复制到剪贴板，粘贴进设置页「应用于会话」',
              },
                React.createElement('span', { className: 'am-menu-item-icon' },
                  React.createElement('svg', { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', 'aria-hidden': 'true' },
                    React.createElement('rect', { x: 5.5, y: 5.5, width: 8, height: 8, rx: 1.5, stroke: 'currentColor', strokeWidth: 1.2 }),
                    React.createElement('path', { d: 'M10.5 4.5V3.75a.75.75 0 0 0-.75-.75h-6a.75.75 0 0 0-.75.75v6c0 .414.336.75.75.75h.75', stroke: 'currentColor', strokeWidth: 1.2 }),
                  ),
                ),
                React.createElement('span', null, '复制会话 ID'),
              )
            },
          )
        })
      }, 'aire-memory: session menu copy id')

      // 原生设置页里的完整配置页面（settings.section）
      ctx.effect(function () {
        return slots.inject('settings.section', function () {
          return slots.register(
            { name: 'settings.section', id: 'aire-memory', order: 200, label: 'Get记忆' },
            function AireSettingsPage() {
              return React.createElement(SettingsPage)
            },
          )
        })
      }, 'aire-memory: settings section')

      // 插件页的「配置」入口：注册 plugins.row.config 渲染器（键 = 包名#行id）。
      // 注册当前名与正式名两个键，改名期与定名后都能命中。
      var rowConfigKeys = ['dsh-get-memory#aire-memory', '@dsh-external/dsh-aire-memory-v9#aire-memory', '@dsh-external/dsh-aire-memory-v8#aire-memory', '@dsh-external/dsh-aire-memory#aire-memory']
      for (var i = 0; i < rowConfigKeys.length; i += 1) {
        ;(function (rowKey) {
          ctx.effect(function () {
            return slots.inject('plugins.row.config', function () {
              return slots.register(
                { name: 'plugins.row.config', key: rowKey },
                function AireRowConfig() {
                  return React.createElement(MemoryPanel)
                },
              )
            })
          }, 'aire-memory: row config ' + rowKey)
        })(rowConfigKeys[i])
      }

      if (config && config.showTurnIndicators !== false) {
        ctx.effect(function () {
          return slots.inject('conversation.chat.turnTail', function () {
            return slots.register(
              { name: 'conversation.chat.turnTail', id: 'aire-memory-turn', order: 10, label: 'Get记忆' },
              function AireTurnIndicator(props) {
                return React.createElement(TurnMemoryIndicator, props)
              },
            )
          })
        }, 'aire-memory: turn indicator')
      }

      if (config && config.showPanelIcon === false) return

      ctx.effect(function () {
        return slots.inject('sidebar.panellist', function () {
          return slots.register(
            { name: 'sidebar.panellist', id: PANEL_KEY, order: 300, label: 'Get记忆' },
            function AirePanelIcon(props) {
              return React.createElement(AireIcon, { size: (props && props.size) || 20, active: !!(props && props.active) })
            },
          )
        })
      }, 'aire-memory: panel icon')

      ctx.effect(function () {
        return slots.inject('main', function () {
          return slots.register(
            { name: 'main', key: PANEL_KEY },
            function AireMemoryPanel() {
              return React.createElement(MemoryPanel)
            },
          )
        })
      }, 'aire-memory: main panel')
    }

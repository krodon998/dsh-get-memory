    // Layer: mount the right-rail icon, the main panel, the Plugins-page row config page, and package styles; all reversible.
    var name = 'dsh-aire-memory'
    var inject = ['slots']

    function apply(ctx, config) {
      var slots = ctx.get('slots')
      if (slots === undefined || React === undefined) return

      ctx.effect(installStyles, 'aire-memory: styles')

      // 全局提示：写回有变动时在输入框下方显示小条（conversation.composer.dock）
      ctx.effect(function () {
        return slots.inject('conversation.composer.dock', function () {
          return slots.register(
            { name: 'conversation.composer.dock', id: 'aire-memory-notice', order: 20, label: 'Get记忆' },
            function AireGlobalNotice() {
              return React.createElement(GlobalMemoryNotice)
            },
          )
        })
      }, 'aire-memory: global notice')

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

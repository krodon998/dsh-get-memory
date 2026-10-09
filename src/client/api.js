    // Layer: host endpoint calls (状态 / 拉取 / 令牌 / 配置都走宿主半边端点).
    function fetchJson(url, options) {
      return fetch(url, options).then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status)
        return response.json()
      })
    }

    function postJson(url, payload) {
      return fetchJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    }

    function fetchStatus() {
      return fetchJson(STATUS_URL)
    }

    function fetchRepos() {
      return fetchJson(REPOS_URL)
    }

    function initRepo() {
      return fetchJson(INIT_URL, { method: 'POST' })
    }

    function checkUpdate() {
      return fetch('https://registry.npmjs.org/dsh-get-memory/latest')
        .then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status)
          return response.json()
        })
    }

    function triggerPull() {
      return fetchJson(PULL_URL, { method: 'POST' })
    }

    function saveToken(value) {
      return postJson(TOKEN_URL, { token: value })
    }

    function updateConfig(patch) {
      return postJson(CONFIG_URL, { patch: patch })
    }

    function syncFiles() {
      return fetchJson(FILESYNC_URL)
    }

    function saveFileModes(modes) {
      return postJson(FILESYNC_URL, { modes: modes })
    }

    function formatTime(iso) {
      if (!iso) return '—'
      var date = new Date(iso)
      if (Number.isNaN(date.getTime())) return String(iso)
      var pad = function (n) { return n < 10 ? '0' + n : String(n) }
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
        + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
    }

    function tokenSourceLabel(source) {
      if (source === 'credentials') return '凭据库'
      if (source === 'env') return '环境变量'
      if (source === 'config') return '插件配置'
      return '其他来源'
    }

    function statusTone(status) {
      if (status === 'ok') return 'ok'
      if (status === 'error') return 'error'
      if (status === 'skip') return 'skip'
      return 'warn'
    }

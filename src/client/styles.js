    // Layer: package stylesheet (plain <style> tag, removed on unload).
    var PANEL_CSS = [
      '.am-panel{display:flex;flex-direction:column;gap:14px;padding:20px;height:100%;overflow-y:auto;box-sizing:border-box;width:100%;max-width:780px;margin:0 auto}',
      '.am-card{background:color-mix(in srgb, var(--ds-color-bg-card,#ffffff) 52%, transparent);backdrop-filter:blur(14px) saturate(1.15);-webkit-backdrop-filter:blur(14px) saturate(1.15);border:1px solid color-mix(in srgb, var(--ds-color-border,#e5e7eb) 62%, transparent);border-radius:14px;padding:14px 16px;box-shadow:0 6px 24px rgba(0,0,0,.06);animation:amFadeIn .28s ease both}',
      '@keyframes amFadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}',
      '.am-title{font-size:13px;font-weight:600;margin:0 0 10px;display:flex;align-items:center;gap:6px}',
      '.am-title .am-pulse{width:7px;height:7px;border-radius:50%;background:#22c55e;animation:amBreathe 2.4s ease-in-out infinite}',
      '@keyframes amBreathe{0%,100%{box-shadow:0 0 0 3px rgba(34,197,94,.18)}50%{box-shadow:0 0 0 6px rgba(34,197,94,.05)}}',
      '.am-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 0}',
      '.am-label{font-size:13px;color:var(--ds-color-text-secondary,#6b7280);flex:none}',
      '.am-value{font-size:13px;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%}',
      '.am-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle;flex:none}',
      '.am-dot.ok{background:#22c55e}.am-dot.warn{background:#f59e0b}.am-dot.error{background:#ef4444}.am-dot.skip{background:#9ca3af}',
      '.am-history{display:flex;flex-direction:column;gap:8px;max-height:280px;overflow-y:auto}',
      '.am-history-item{font-size:12px;line-height:1.5;display:flex;gap:6px;align-items:baseline}',
      '.am-history-item>span:last-child{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.am-history-time{color:var(--ds-color-text-tertiary,#9ca3af);flex:none}',
      '.am-history-kind{flex:none;font-size:11px;padding:0 5px;border-radius:4px;background:color-mix(in srgb, var(--ds-color-bg-secondary,#f3f4f6) 72%, transparent);color:var(--ds-color-text-secondary,#6b7280)}',
      '.am-input{flex:1;min-width:0;font-size:13px;padding:6px 8px;border-radius:8px;border:1px solid var(--ds-color-border,#e5e7eb);background:color-mix(in srgb, var(--ds-color-bg-input,#ffffff) 60%, transparent);color:inherit;transition:border-color .15s}',
      '.am-input:focus{border-color:var(--ds-color-accent,#4f46e5);outline:none}',
      '.am-textarea{flex:1;min-width:0;font-size:13px;padding:6px 8px;border-radius:8px;border:1px solid var(--ds-color-border,#e5e7eb);background:color-mix(in srgb, var(--ds-color-bg-input,#ffffff) 60%, transparent);color:inherit;resize:vertical;font-family:inherit;line-height:1.5}',
      '.am-button{font-size:13px;padding:6px 12px;border-radius:8px;border:1px solid var(--ds-color-border,#e5e7eb);background:color-mix(in srgb, var(--ds-color-bg-secondary,#f3f4f6) 80%, transparent);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);color:inherit;cursor:pointer;transition:filter .15s,transform .05s;flex:none}',
      '.am-button:hover:not(:disabled){filter:brightness(.96)}',
      '.am-button:active:not(:disabled){transform:scale(.98)}',
      '.am-button.primary{background:var(--ds-color-accent,#4f46e5);border-color:transparent;color:#fff}',
      '.am-button.primary:hover:not(:disabled){filter:brightness(1.08)}',
      '.am-button:disabled{opacity:.55;cursor:default}',
      '.am-notice{font-size:12px;color:var(--ds-color-text-secondary,#6b7280)}',
      '.am-empty{font-size:12px;color:var(--ds-color-text-tertiary,#9ca3af);padding:6px 0}',
      '.am-switch{position:relative;width:36px;height:20px;border-radius:999px;border:1px solid var(--ds-color-border,#e5e7eb);background:var(--ds-color-bg-secondary,#e5e7eb);cursor:pointer;flex:none;transition:background .15s}',
      '.am-switch.on{background:var(--ds-color-accent,#4f46e5);border-color:transparent}',
      '.am-switch::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .15s}',
      '.am-switch.on::after{left:18px}',
      '.am-switch:focus-visible{outline:2px solid var(--ds-color-accent,#4f46e5);outline-offset:2px}',
      '.am-indicator{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--ds-color-text-tertiary,#9ca3af);padding:2px 0}',
      '.am-indicator .am-dot{margin-right:0}',
      '.am-indicator:hover{color:var(--ds-color-text-secondary,#6b7280)}',
      '.am-global-notice{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--ds-color-text-secondary,#6b7280);background:color-mix(in srgb, var(--ds-color-bg-card,#ffffff) 72%, transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid color-mix(in srgb, var(--ds-color-border,#e5e7eb) 60%, transparent);border-radius:999px;padding:4px 12px;animation:amFadeIn .28s ease both}',
      '.am-global-notice .am-dot{margin-right:0}',
    ].join('\n')

    function installStyles() {
      if (document.getElementById(STYLE_ID)) return function () {}
      var tag = document.createElement('style')
      tag.id = STYLE_ID
      tag.setAttribute('data-dyn', PACKAGE)
      tag.textContent = PANEL_CSS
      document.head.append(tag)
      return function () { tag.remove() }
    }

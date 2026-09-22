export interface ThemePartsState {
  cleanup: () => void
  refresh: () => void
}

/**
 * 为 Codex 页面安装可逆的语义区域标记。
 *
 * 此函数不得依赖模块闭包，调用方会把函数源码序列化到渲染进程执行。
 */
export function install_theme_parts(): ThemePartsState {
  const state_key = '__CODEX_MANAGER_THEME_PARTS_STATE__'
  const attribute_name = 'data-cm-theme-part'
  const scope = window as unknown as Record<string, ThemePartsState | undefined>
  scope[state_key]?.cleanup()

  const tracked = new Map<Element, { original: string | null; original_parts: Set<string>; owned: Set<string> }>()
  const supported_parts = new Set([
    'root', 'titlebar', 'header', 'sidebar', 'project-list', 'conversation', 'main',
    'home', 'thread', 'message', 'composer', 'composer-toolbar', 'right-panel',
    'settings', 'panel', 'menu', 'menu-item', 'dialog', 'tooltip', 'input',
    'button', 'tab', 'code', 'diff', 'terminal',
  ])
  let stopped = false
  let pending_frame = 0

  const desired = new Map<Element, Set<string>>()
  const add = (part: string, nodes: Iterable<Element>): void => {
    for (const node of nodes) {
      const parts = desired.get(node) ?? new Set<string>()
      parts.add(part)
      desired.set(node, parts)
    }
  }
  const select = (selector: string): Element[] => Array.from(document.querySelectorAll(selector))
  const add_selector = (part: string, selector: string): void => add(part, select(selector))
  const is_settings_route = (): boolean => location.pathname === '/settings' || location.pathname.startsWith('/settings/')
  const ui_nodes = (selector: string): Element[] => select(selector).filter(node => !node.closest(
    '[data-message-author-role], pre, code',
  ))
  const interactive_nodes = (selector: string): Element[] => ui_nodes(selector).filter(node => {
    if (node.matches('[data-testid="floating-composer-reveal-handle"]')) return false
    if (node.closest('.titlebar, [data-testid="titlebar"], [data-testid="app-shell-titlebar"]')) return false
    if (is_settings_route() && node.closest('main, [role="main"]') && !node.closest('[role="dialog"], [aria-modal="true"]')) return true
    return !!node.closest(
      '.composer-surface-chrome, [data-composer-surface-variant], [class*="_ComposerLayoutRoot_"], ' +
      '[role="dialog"], [aria-modal="true"], [role="menu"], ' +
      'aside.app-shell-left-panel, [data-testid="app-shell-floating-left-panel"], ' +
      '[role="tabpanel"][data-app-shell-tab-panel-controller="right"]',
    )
  })

  const classify = (): void => {
    desired.clear()
    add('root', [document.documentElement])
    const titlebar_nodes = select('[data-pip-obstacle="app-shell-header"][data-app-shell-header-layout]')
    add('titlebar', titlebar_nodes)
    add('header', [...titlebar_nodes, ...ui_nodes('[role="banner"]')])
    add_selector('sidebar', 'aside.app-shell-left-panel, [data-testid="app-shell-floating-left-panel"], aside[data-testid="app-shell-left-panel"]')
    add_selector('project-list', '[data-app-action-sidebar-project-list-id], [data-app-action-sidebar-project-row]')
    add_selector('conversation', '[data-app-action-sidebar-thread-row]')
    add_selector('main', 'main, [role="main"]')
    add_selector('home', '[data-testid="chatgpt-work-home-page"], [data-testid="home-page"], main.home-page')
    add_selector('thread', '.thread-scroll-container, [data-testid="thread"], main.thread-page')
    add_selector('message', '[data-message-author-role]')

    const composer_nodes = select('.composer-surface-chrome, [data-composer-surface-variant][data-composer-radius-variant], [class*="_ComposerLayoutRoot_"]')
      .filter(node => !node.matches('button, [role="button"], [data-testid="floating-composer-reveal-handle"]'))
    add('composer', composer_nodes)
    add_selector('composer-toolbar', '[data-composer-footer-responsive], [class*="_ComposerLayoutFooter_"], .composer-surface-chrome [role="toolbar"]')
    const right_panel_nodes = select('[role="tabpanel"][data-app-shell-tab-panel-controller="right"]')
    add('right-panel', right_panel_nodes)
    if (is_settings_route()) {
      add('settings', select('main, [role="main"]').filter(node => !node.closest('[role="dialog"], [aria-modal="true"]')))
    }
    const dialog_nodes = ui_nodes('[role="dialog"], [aria-modal="true"]')
    add('panel', [...right_panel_nodes, ...dialog_nodes])
    add_selector('menu', '[role="menu"], [data-radix-menu-content]')
    add_selector('menu-item', '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]')
    add('dialog', dialog_nodes)
    add_selector('tooltip', '[role="tooltip"], [data-radix-tooltip-content]')
    add('input', interactive_nodes('input, textarea, [contenteditable="true"], [role="textbox"], select'))
    add('button', interactive_nodes('button, [role="button"]'))
    add('tab', interactive_nodes('[role="tab"]'))
    add_selector('code', 'pre, code, [class~="code"]')
    add_selector('diff', '.diff, [data-testid="diff-preview-scroll"]')
    add_selector('terminal', '.terminal, [data-testid="terminal"]')

    if (document.body?.hasAttribute('data-preview-view')) {
      for (const node of select('[data-cm-preview-part]')) {
        const parts = node.getAttribute('data-cm-preview-part')?.split(/\s+/).filter(part => supported_parts.has(part)) ?? []
        for (const part of parts) add(part, [node])
      }
    }
  }

  const write_parts = (node: Element, parts: Set<string>): void => {
    let record = tracked.get(node)
    if (!record) {
      const original = node.getAttribute(attribute_name)
      record = {
        original,
        original_parts: new Set((original ?? '').split(/\s+/).filter(Boolean)),
        owned: new Set<string>(),
      }
      tracked.set(node, record)
    }
    const current = (node.getAttribute(attribute_name) ?? '').split(/\s+/).filter(Boolean)
    const preserved = current.filter(part => !record?.owned.has(part))
    if (!parts.size) {
      if (record.original === null && node.hasAttribute(attribute_name)) node.removeAttribute(attribute_name)
      else if (record.original !== null && node.getAttribute(attribute_name) !== record.original) {
        node.setAttribute(attribute_name, record.original)
      }
      record.owned.clear()
      return
    }
    const next = [...new Set([...preserved, ...parts])]
    const next_value = next.join(' ')
    const same_tokens = current.length === next.length && current.every(part => next.includes(part))
    if (next_value && !same_tokens) node.setAttribute(attribute_name, next_value)
    else if (!next_value && node.hasAttribute(attribute_name)) node.removeAttribute(attribute_name)
    record.owned = new Set([...parts].filter(part => !record?.original_parts.has(part)))
  }

  const refresh = (): void => {
    if (stopped) return
    classify()
    for (const [node] of tracked) {
      if (!desired.has(node)) {
        write_parts(node, new Set())
        tracked.delete(node)
      }
    }
    for (const [node, parts] of desired) write_parts(node, parts)
  }

  const schedule = (): void => {
    if (stopped || pending_frame) return
    pending_frame = window.requestAnimationFrame(() => {
      pending_frame = 0
      refresh()
    })
  }
  const observer = new MutationObserver(schedule)
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [
      'class', 'role', 'aria-label', 'aria-modal', 'contenteditable',
      'data-testid', 'data-message-author-role', 'data-composer-surface-variant',
      'data-composer-radius-variant', 'data-composer-footer-responsive', 'data-preview-view', 'data-cm-preview-part',
      'data-radix-menu-content', 'data-radix-tooltip-content',
      'data-pip-obstacle', 'data-app-shell-header-layout',
      'data-app-action-sidebar-project-list-id', 'data-app-action-sidebar-project-row',
      'data-app-action-sidebar-thread-row',
      'data-app-shell-tab-panel-controller', 'data-tab-id',
    ],
  })

  const cleanup = (): void => {
    if (stopped) return
    stopped = true
    observer.disconnect()
    if (pending_frame) window.cancelAnimationFrame(pending_frame)
    pending_frame = 0
    for (const [node, record] of tracked) {
      if (record.original === null) node.removeAttribute(attribute_name)
      else node.setAttribute(attribute_name, record.original)
    }
    tracked.clear()
    desired.clear()
    if (scope[state_key]?.cleanup === cleanup) delete scope[state_key]
  }

  const state = { cleanup, refresh }
  scope[state_key] = state
  refresh()
  return state
}

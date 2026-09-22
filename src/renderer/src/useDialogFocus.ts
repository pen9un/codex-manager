import { useEffect, useRef } from 'react'

/** 限制焦点在最上层弹窗内，关闭时回到触发控件。 */
export function useDialogFocus(open: boolean, close: () => void, return_focus?: HTMLElement | null): void {
  const close_ref = useRef(close)
  close_ref.current = close
  useEffect(() => {
    if (!open) return
    const opener = return_focus || document.activeElement as HTMLElement | null
    const dialog = [...document.querySelectorAll<HTMLElement>('.backdrop .modal')].at(-1)
    if (!dialog) return
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    if (!dialog.hasAttribute('aria-labelledby')) dialog.setAttribute('aria-label', dialog.querySelector('h2')?.textContent || '详情')
    dialog.tabIndex = -1
    const focusable = (): HTMLElement[] => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')].filter(element => element.getClientRects().length > 0)
    const topmost = () => [...document.querySelectorAll('.backdrop .modal')].at(-1) === dialog
    ;(dialog.querySelector<HTMLElement>('[data-initial-focus]') || focusable()[0] || dialog).focus()
    const on_key = (event: KeyboardEvent): void => {
      if (!topmost()) return
      if (event.key === 'Escape' && !dialog.querySelector('[role="menu"]')) { event.preventDefault(); event.stopImmediatePropagation(); close_ref.current(); return }
      if (event.key !== 'Tab') return
      const elements = focusable(), first = elements[0] || dialog, last = elements.at(-1) || dialog
      if (!dialog.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) { event.preventDefault(); (event.shiftKey ? last : first).focus() }
    }
    document.addEventListener('keydown', on_key, true)
    return () => { document.removeEventListener('keydown', on_key, true); if (opener?.isConnected) opener.focus() }
  }, [open])
}

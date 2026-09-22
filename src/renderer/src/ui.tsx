import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Check, ChevronDown, CircleAlert, LoaderCircle, MoreHorizontal, Search, X } from 'lucide-react'
import { useDialogFocus } from './useDialogFocus'

export type LeaveGuard = () => Promise<boolean>
export type RegisterGuard = (guard: LeaveGuard | null) => void
export interface NoticeValue { text: string; error?: boolean }
interface ConfirmOptions { title: string; description: string; action?: string; danger?: boolean }
const confirm_context = createContext<(options: ConfirmOptions) => Promise<boolean>>(async () => false)
export const use_confirm = () => useContext(confirm_context)

export function Button({ variant = 'secondary', className = '', children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; children: ReactNode }): React.JSX.Element {
  return <button type="button" className={`button ${variant} ${className}`} {...props}>{children}</button>
}

export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }): React.JSX.Element {
  return <header className="page-head"><div><h1>{title}</h1><p>{description}</p></div>{actions && <div className="page-actions">{actions}</div>}</header>
}

export function StatusBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }): React.JSX.Element {
  return <span className={`status-badge ${tone}`}><i aria-hidden="true" />{children}</span>
}

export function SearchField({ value, on_change, placeholder, label }: { value: string; on_change: (value: string) => void; placeholder: string; label: string }): React.JSX.Element {
  return <label className="search-field"><Search size={16} aria-hidden="true" /><input aria-label={label} placeholder={placeholder} value={value} onChange={event => on_change(event.target.value)} />{value && <button type="button" aria-label={`清除${label}`} onClick={() => on_change('')}><X size={14} /></button>}</label>
}

export function Notice({ value, clear }: { value: NoticeValue | null; clear: () => void }): React.JSX.Element | null {
  const clear_ref = useRef(clear)
  clear_ref.current = clear
  useEffect(() => {
    if (!value || value.error) return
    const timer = window.setTimeout(() => clear_ref.current(), 4000)
    return () => window.clearTimeout(timer)
  }, [value])
  if (!value) return null
  return <div className={`notice ${value.error ? 'error' : 'ok'}`} role={value.error ? 'alert' : 'status'}>{value.error ? <CircleAlert size={18} /> : <Check size={18} />}<span>{value.text}</span><button type="button" aria-label="关闭通知" onClick={clear}><X size={16} /></button></div>
}

export function EmptyState({ title, description, loading = false, action }: { title: string; description?: string; loading?: boolean; action?: ReactNode }): React.JSX.Element {
  return <div className="empty-state" role={loading ? 'status' : undefined}>{loading ? <LoaderCircle className="spin" size={24} /> : <Search size={24} />}<h2>{title}</h2>{description && <p>{description}</p>}{action}</div>
}

export function Dialog({ title, description, children, close, actions, className = '', busy = false, drawer = false, return_focus }: { title: string; description?: string; children?: ReactNode; close: () => void; actions?: ReactNode; className?: string; busy?: boolean; drawer?: boolean; return_focus?: HTMLElement | null }): React.JSX.Element {
  const title_id = useId()
  const close_ref = useRef(close)
  close_ref.current = close
  const dismiss = useCallback(() => { if (!busy) close_ref.current() }, [busy])
  useDialogFocus(true, dismiss, return_focus)
  return <div className={`backdrop ${drawer ? 'drawer-backdrop' : ''} ${className.includes('confirm-dialog') ? 'confirm-backdrop' : ''}`} onMouseDown={event => { if (event.target === event.currentTarget) dismiss() }}>
    <section className={`modal ${drawer ? 'detail-panel' : ''} ${className}`} role="dialog" aria-modal="true" aria-labelledby={title_id} aria-busy={busy} tabIndex={-1}>
      <header className="dialog-head"><div><h2 id={title_id}>{title}</h2>{description && <p>{description}</p>}</div><Button variant="ghost" className="icon-button close" aria-label={`关闭${title}`} disabled={busy} onClick={dismiss}><X size={18} /></Button></header>
      {children && <div className="dialog-body">{children}</div>}
      {actions && <footer className="dialog-actions">{actions}</footer>}
    </section>
  </div>
}

export function ConfirmProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [options, set_options] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((accepted: boolean) => void) | null>(null)
  const confirm = useCallback((next: ConfirmOptions) => {
    if (resolver.current) return Promise.resolve(false)
    return new Promise<boolean>(resolve => { resolver.current = resolve; set_options(next) })
  }, [])
  const finish = useCallback((accepted: boolean) => { const resolve = resolver.current; resolver.current = null; set_options(null); resolve?.(accepted) }, [])
  useEffect(() => () => { resolver.current?.(false); resolver.current = null }, [])
  return <confirm_context.Provider value={confirm}>{children}{options && <Dialog title={options.title} description={options.description} close={() => finish(false)} className="confirm-dialog" actions={<><Button data-initial-focus onClick={() => finish(false)}>取消</Button><Button variant={options.danger ? 'danger' : 'primary'} onClick={() => finish(true)}>{options.action || '继续'}</Button></>} />}</confirm_context.Provider>
}

export interface MenuItem { label: string; action: () => void; danger?: boolean; disabled?: boolean }
export function ActionMenu({ label = '更多操作', items, disabled = false, icon_only = false }: { label?: string; items: MenuItem[]; disabled?: boolean; icon_only?: boolean }): React.JSX.Element {
  const [open, set_open] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu_id = useId()
  const close_menu = (restore = false) => { set_open(false); if (restore) trigger.current?.focus() }
  useEffect(() => {
    if (!open) return
    root.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) set_open(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  return <div className="action-menu" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) set_open(false) }}>
    <button type="button" ref={trigger} className={`button secondary ${icon_only ? 'icon-button' : ''}`} aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menu_id : undefined} disabled={disabled} onClick={() => set_open(!open)} onKeyDown={event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); set_open(true) } }}>{icon_only ? <MoreHorizontal size={18} /> : <>{label}<ChevronDown size={14} /></>}</button>
    {open && <div className="menu-popover" role="menu" id={menu_id} aria-label={label} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close_menu(true) }
      if (event.key === 'Tab') close_menu()
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        const choices = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')]
        const index = choices.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length
        choices[next]?.focus()
      }
    }}>{items.map(item => <button type="button" role="menuitem" key={item.label} disabled={item.disabled} className={item.danger ? 'danger-text' : ''} onClick={() => { close_menu(true); item.action() }}>{item.label}</button>)}</div>}
  </div>
}

export function use_leave_guard(register: RegisterGuard, guard: LeaveGuard): void {
  const guard_ref = useRef(guard)
  guard_ref.current = guard
  useEffect(() => { register(() => guard_ref.current()); return () => register(null) }, [register])
}

export function error_text(error: unknown): string {
  const message = error instanceof Error ? error.message : '操作失败，请重试'
  if (/Unexpected (token|end).*JSON|Expected .*JSON|is not valid JSON/i.test(message)) {
    const location = message.match(/line (\d+) column (\d+)/i)
    return `JSON 格式无效${location ? `（第 ${location[1]} 行，第 ${location[2]} 列）` : ''}，请检查引号、逗号和括号。`
  }
  return message
}

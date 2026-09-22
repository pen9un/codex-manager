import { useEffect, useRef, useState } from 'react'

const pane_names = ['.memory-categories', '.memory-list', '.memory-detail']
const share_names = ['--memory-category-share', '--memory-list-share', '--memory-detail-share']
const default_shares = [17, 29, 54]
const minimum_widths = [150, 220, 280]

export function MemoryDivider({ index }: { index: 0 | 1 }): React.JSX.Element {
  const element = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; left: number; total: number; share: number; root: HTMLElement } | null>(null)
  const [value, set_value] = useState(Math.round(default_shares[index] / (default_shares[index] + default_shares[index + 1]) * 100))
  const measure = () => {
    const root = element.current!.parentElement!
    const left = root.querySelector<HTMLElement>(pane_names[index])!.getBoundingClientRect().width
    const right = root.querySelector<HTMLElement>(pane_names[index + 1])!.getBoundingClientRect().width
    const shares = default_shares.map((fallback, i) => Number.parseFloat(root.style.getPropertyValue(share_names[i])) || fallback)
    return { root, left, total: left + right, share: shares[index] + shares[index + 1] }
  }
  const resize = (layout: ReturnType<typeof measure>, width: number) => {
    const scale = Math.min(1, layout.total / (minimum_widths[index] + minimum_widths[index + 1]))
    const left = Math.max(minimum_widths[index] * scale, Math.min(width, layout.total - minimum_widths[index + 1] * scale))
    const ratio = left / layout.total
    layout.root.style.setProperty(share_names[index], `${layout.share * ratio}fr`)
    layout.root.style.setProperty(share_names[index + 1], `${layout.share * (1 - ratio)}fr`)
    set_value(Math.round(ratio * 100))
  }
  const stop = () => { drag.current?.root.classList.remove('is-resizing'); drag.current = null }
  useEffect(() => stop, [])
  return <div ref={element} className={`memory-divider memory-divider-${index}`} role="separator" aria-orientation="vertical"
    aria-label={index === 0 ? '调整记忆分类与列表栏宽' : '调整记忆列表与正文栏宽'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}
    title="拖动或使用左右方向键调整栏宽；双击恢复比例" tabIndex={0}
    onPointerDown={event => {
      if (event.button !== 0) return
      event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { ...measure(), x: event.clientX }; drag.current.root.classList.add('is-resizing')
    }}
    onPointerMove={event => { if (drag.current) resize(drag.current, drag.current.left + event.clientX - drag.current.x) }}
    onPointerUp={event => { stop(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
    onPointerCancel={stop} onLostPointerCapture={stop}
    onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
      event.preventDefault(); const layout = measure(); resize(layout, layout.left + (event.key === 'ArrowRight' ? 20 : -20))
    }}
    onDoubleClick={() => { const layout = measure(); resize(layout, layout.total * default_shares[index] / (default_shares[index] + default_shares[index + 1])) }} />
}

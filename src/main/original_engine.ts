import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { buildPayload } from './vendor/codex-themes/engine/payload'
import type { SkinMode } from '../shared/skins'
import { install_theme_parts } from './theme_parts'

export type OriginalMotion = 'none' | 'orbit' | 'rain' | 'cloud' | 'float' | 'breeze' | 'moonlight'

export interface OriginalExtension {
  art: Record<SkinMode, string>
  style: string
  motion: OriginalMotion
  ui_revision?: 1
}

const media_type = (name: string): string => ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.png': 'image/png' })[extname(name).toLowerCase()] || 'application/octet-stream'
const data_url = (name: string, bytes: Uint8Array): string => `data:${media_type(name)};base64,${Buffer.from(bytes).toString('base64')}`

const original_runtime_css = `
#codex-original-motion{position:absolute;inset:0 0 auto auto;width:44%;height:46%;z-index:-1;pointer-events:none;overflow:hidden;opacity:.32}
#codex-original-motion::before,#codex-original-motion::after{content:"";position:absolute;inset:-18%;animation-duration:18s;animation-timing-function:linear;animation-iteration-count:infinite;animation-play-state:var(--original-play-state,paused)}
#codex-original-motion[data-motion="orbit"]::before{border:1px solid color-mix(in srgb,var(--color-accent,#638cff) 45%,transparent);border-radius:50%;inset:12% 28%;animation-name:original-orbit}
#codex-original-motion[data-motion="rain"]::before{background:repeating-linear-gradient(105deg,transparent 0 16px,color-mix(in srgb,var(--color-accent,#638cff) 18%,transparent) 17px 18px);animation-name:original-rain}
#codex-original-motion[data-motion="cloud"]::before{background:radial-gradient(ellipse at 30% 45%,rgba(255,255,255,.22),transparent 32%),radial-gradient(ellipse at 72% 55%,rgba(255,255,255,.16),transparent 28%);filter:blur(16px);animation-name:original-cloud}
#codex-original-motion[data-motion="float"]::before{background:radial-gradient(circle at 20% 70%,var(--color-accent,#638cff) 0 2px,transparent 3px),radial-gradient(circle at 68% 35%,var(--color-secondary,#77b8a5) 0 3px,transparent 4px);background-size:110px 130px,170px 150px;animation-name:original-float}
#codex-original-motion[data-motion="breeze"]::before{background:repeating-radial-gradient(ellipse at 0 50%,transparent 0 24px,color-mix(in srgb,var(--color-secondary,#77b8a5) 14%,transparent) 25px 26px,transparent 27px 48px);animation-name:original-breeze}
#codex-original-motion[data-motion="moonlight"]::before{background:radial-gradient(circle at 78% 14%,rgba(255,255,220,.3),transparent 17%),linear-gradient(120deg,transparent 30%,rgba(190,215,255,.12),transparent 68%);animation-name:original-moonlight;animation-direction:alternate}
html[data-original-theme]{--dream-skin-art:var(--original-art) !important;--ds-accent:var(--ds-green);--color-background:var(--ds-bg);--color-panel:var(--ds-panel);--color-text:var(--ds-text);--color-border:var(--ds-line);--color-accent:var(--ds-green);--color-secondary:var(--ds-cyan)}
@keyframes original-orbit{to{transform:translate3d(5%,-3%,0);opacity:.4}}
@keyframes original-rain{to{transform:translate3d(-80px,110px,0)}}
@keyframes original-cloud{to{transform:translate3d(9%,2%,0)}}
@keyframes original-float{to{transform:translate3d(0,-90px,0)}}
@keyframes original-breeze{to{transform:translate3d(80px,-12px,0)}}
@keyframes original-moonlight{to{opacity:.55;transform:translate3d(-3%,2%,0)}}
@media(prefers-reduced-motion:reduce){#codex-original-motion{display:none}}
`

// 任务页只在阅读卡片外围显示场景，不更改原生列宽、滚动和输入位置。
const task_art_css = `
html.codex-dream-skin[data-dream-theme][data-original-theme][data-original-mode] body :is(main.main-surface,main.dream-skin-main-surface):not(.dream-skin-home-shell):has(.thread-scroll-container) {
  background-color:var(--ds-bg)!important;
  background-image:linear-gradient(color-mix(in srgb,var(--ds-bg) 24%,transparent),color-mix(in srgb,var(--ds-bg) 24%,transparent)),var(--original-art)!important;
  background-size:cover!important;background-position:right center!important;background-repeat:no-repeat!important;background-attachment:scroll!important;
}
html.codex-dream-skin[data-dream-theme][data-original-theme][data-original-mode] body :is(main.main-surface,main.dream-skin-main-surface):not(.dream-skin-home-shell) .thread-scroll-container {
  background:transparent!important;
}
html.codex-dream-skin[data-dream-theme][data-original-theme][data-original-mode] body .thread-scroll-container :is([data-turn-key],article) {
  background-color:var(--ds-bg)!important;
  box-shadow:0 0 0 12px var(--ds-bg)!important;border-radius:var(--cm-row-radius,10px)!important;
}
`

export async function build_original_payload(
  engine_root: string,
  theme_root: string,
  extension: OriginalExtension,
  mode: SkinMode | undefined,
  motion_enabled: boolean,
): Promise<string> {
  const [built, original_css, dark_bytes] = await Promise.all([
    buildPayload(engine_root, theme_root),
    readFile(join(theme_root, extension.style), 'utf8'),
    readFile(join(theme_root, extension.art.dark)),
  ])
  const dark_art = data_url(extension.art.dark, dark_bytes)
  return `(() => {
    window.__CODEX_ORIGINAL_THEME_STATE__?.cleanup?.();
    window.__CODEX_DREAM_SKIN_STATE__?.cleanup?.();
    const root = document.documentElement;
    root.dataset.originalTheme = 'pending';
    const installed = ${built.payload};
    const themeParts = ${extension.ui_revision === 1 ? `(${install_theme_parts.toString()})()` : 'null'};
    const style = document.createElement('style');
    style.id = 'codex-original-theme-style';
    style.textContent = ${JSON.stringify(`${original_runtime_css}\n${original_css}\n${task_art_css}`)};
    document.head.appendChild(style);
    const darkData = ${JSON.stringify(dark_art)};
    const comma = darkData.indexOf(',');
    const binary = atob(darkData.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const darkUrl = URL.createObjectURL(new Blob([bytes], {type: ${JSON.stringify(media_type(extension.art.dark))}}));
    const layer = document.createElement('div');
    layer.id = 'codex-original-motion';
    layer.dataset.motion = ${JSON.stringify(extension.motion)};
    document.body.prepend(layer);
    let motionEnabled = ${JSON.stringify(motion_enabled)};
    const forcedMode = ${JSON.stringify(mode ?? null)};
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const isDark = () => forcedMode ? forcedMode === 'dark' : root.getAttribute('data-dream-shell') === 'dark';
    const isHome = () => !!document.querySelector('main.dream-skin-home-shell');
    const setProperty = (name, value) => {if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);};
    const sync = () => {
      const homeSurface = document.querySelector('main.dream-skin-home-shell');
      if (homeSurface && layer.parentElement !== homeSurface) homeSurface.appendChild(layer);
      const active = motionEnabled && ${JSON.stringify(extension.motion !== 'none')} && isHome() && !document.hidden && document.hasFocus() && !reduced.matches;
      if (root.dataset.originalTheme !== installed.themeId) root.dataset.originalTheme = installed.themeId;
      const currentMode = isDark() ? 'dark' : 'light';
      if (root.dataset.originalMode !== currentMode) root.dataset.originalMode = currentMode;
      setProperty('--original-art', 'url("' + (currentMode === 'dark' ? darkUrl : window.__CODEX_DREAM_SKIN_STATE__?.artUrl) + '")');
      setProperty('--original-play-state', active ? 'running' : 'paused');
      layer.hidden = ${JSON.stringify(extension.motion === 'none')} || !isHome();
      layer.dataset.paused = active ? 'false' : 'true';
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {subtree:true,childList:true,attributes:true,attributeFilter:['class','data-theme','data-appearance','data-color-mode','data-dream-shell']});
    const focus = () => sync();
    document.addEventListener('visibilitychange', focus);
    window.addEventListener('focus', focus);
    window.addEventListener('blur', focus);
    reduced.addEventListener('change', focus);
    const cleanupExtension = () => {
      observer.disconnect();
      themeParts?.cleanup();
      document.removeEventListener('visibilitychange', focus);
      window.removeEventListener('focus', focus);
      window.removeEventListener('blur', focus);
      reduced.removeEventListener('change', focus);
      layer.remove(); style.remove(); URL.revokeObjectURL(darkUrl);
      root.removeAttribute('data-original-theme'); root.removeAttribute('data-original-mode');
      root.style.removeProperty('--original-art'); root.style.removeProperty('--original-play-state');
      delete window.__CODEX_ORIGINAL_THEME_STATE__;
    };
    window.__CODEX_ORIGINAL_THEME_STATE__ = {cleanup:cleanupExtension,setMotion:(enabled) => {motionEnabled=!!enabled;sync();}};
    const baseCleanup = window.__CODEX_DREAM_SKIN_STATE__?.cleanup;
    if (window.__CODEX_DREAM_SKIN_STATE__ && baseCleanup) window.__CODEX_DREAM_SKIN_STATE__.cleanup = () => {cleanupExtension();return baseCleanup();};
    sync();
    return installed;
  })()`
}

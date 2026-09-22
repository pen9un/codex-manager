// 从固定上游提交收录原文，保留授权和可复核的摘要；不生成或改写提示词正文。
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const repo = 'github/awesome-copilot'
const revision = '9ce814859eaa473178a1463ee3aa0c54a8860b86'
async function download(url) { const response = await fetch(url); if (!response.ok) throw Error(`下载失败：${response.status} ${url}`); return response.text() }
async function source_file(repository, commit, file) {
  const response = JSON.parse(await download(`https://api.github.com/repos/${repository}/contents/${file}?ref=${commit}`))
  if (response.encoding !== 'base64') throw Error('上游未返回可校验的文件正文')
  return Buffer.from(response.content, 'base64').toString('utf8')
}
const metadata = JSON.parse(await download(`https://api.github.com/repos/${repo}`))
const definitions = [
  ['test-gap-audit', '测试覆盖缺口审计', '测试审计', '只读评估关键行为、断言质量和缺失回归，输出有证据的测试建议。', 'skills/test-gap-audit/SKILL.md', '含可选 coverage_map.py 引用；本库不安装脚本，原文也提供手动检查路径。'],
  ['create-specification', '需求规格与验收契约', '需求规格', '将目标整理为需求、约束、接口、边界情况和可测试的验收标准。', 'skills/create-specification/SKILL.md', '使用前替换 ${input:SpecPurpose}；原文 /spec/ 输出路径应服从项目目录规则。'],
  ['markdown-accessibility', 'Markdown 文档无障碍审查', '文档质量', '检查链接、替代文本、标题层级、列表及清晰表达，并解释影响。', 'instructions/markdown-accessibility.instructions.md', '适用于 Markdown 文档；applyTo 元数据不会由本管理器自动执行。'],
  ['performance-optimization', 'Web 性能审查与优化', '性能优化', '按 Core Web Vitals、渲染、资源加载和框架反模式评估 Web 性能。', 'instructions/performance-optimization.instructions.md', '内容较长，按项目框架选择适用项并测量验证；不是通用系统提示词。'],
]
const entries = []
for (const [id, name, scenario, description, source_path, warning] of definitions) {
  const content = await source_file(repo, revision, source_path)
  entries.push({ id, name, description, content, scenario, source: `${repo} · 完整上游原文`, sourceUrl: `https://github.com/${repo}/blob/${revision}/${source_path}`, sourceWarning: `英文上游原文完整保留。${warning} 仅保存到管理器，不安装插件。`, riskBoundary: '用于对应工程场景，遵循当前任务授权与项目规则', revision, license: 'MIT', stars: metadata.stargazers_count, checkedAt: new Date().toISOString(), upstreamSha256: createHash('sha256').update(content).digest('hex') })
}
const existing = JSON.parse(await readFile(`${root}src/shared/vendor/prompt-sources.json`, 'utf8'))
const review = existing.find(item => item.id === 'codex-review')
const review_path = new URL(review.sourceUrl).pathname.replace('/openai/codex/blob/', '')
const review_content = await source_file('openai/codex', review_path.slice(0, 40), review_path.slice(41))
if (review_content !== review.content) throw Error('已收录的官方审查原文与固定提交不同')
entries.unshift({ ...review, stars: JSON.parse(await download('https://api.github.com/repos/openai/codex')).stargazers_count, checkedAt: new Date().toISOString() })
await mkdir(`${root}src/shared/vendor`, { recursive: true })
await writeFile(`${root}src/shared/vendor/awesome-copilot-LICENSE.txt`, await source_file(repo, revision, 'LICENSE'))
await writeFile(`${root}src/shared/vendor/prompt-sources.json`, JSON.stringify(entries, null, 2) + '\n')
console.log(`已校验并收录 ${entries.length} 份上游原文`)

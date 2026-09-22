// 分批启动隔离 Electron，避免完整主题矩阵在同一渲染进程内累积内存。
const fs = require('node:fs/promises')
const fs_sync = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { createHash } = require('node:crypto')
const root = path.resolve(__dirname, '..')
const argument = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const catalog_ids = JSON.parse(fs_sync.readFileSync(path.join(root, 'resources/skins/catalog.json'), 'utf8')).map(item => item.id)
const ids = argument('ids')?.split(',') || catalog_ids
const scales = argument('scale')?.split(',') || ['1', '1.25', '1.5']
const output_root = path.resolve(argument('output') || path.join(root, 'reports/theme-ui-complete-20260921'))
const resume = process.argv.includes('--resume')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const sizes = [[1280, 800], [920, 650], [1920, 1080]]
const modes = ['light', 'dark']
const views = ['home', 'task', 'settings', 'components']
const state_key = state => [state.id, state.mode, state.view, state.width, state.height].join('/')
const read_json = async filename => JSON.parse(await fs.readFile(filename, 'utf8'))
const write_json = async (filename, value) => fs.writeFile(filename, JSON.stringify(value, null, 2))

async function validate_result(result, batch_ids, scale, directory, engine_hash, runtime_hashes, engine_resource_hashes) {
  assert.equal(result.passed, true, '分批验收未完成或失败')
  assert.equal(result.scale, scale, '分批缩放不一致')
  assert.equal(result.engine_bundle_sha256, engine_hash, '分批预览引擎已变化')
  assert.deepEqual(result.engine_resource_hashes, engine_resource_hashes, '分批引擎资源与当前资源不一致')
  assert.deepEqual(result.errors, [], '分批存在控制台错误')
  const expected_keys = batch_ids.flatMap(id => modes.flatMap(mode => views.flatMap(view => sizes.map(([width, height]) => state_key({ id, mode, view, width, height })))))
  assert.deepEqual(result.states.map(state_key).sort(), expected_keys.sort(), '分批状态必须完整且不重复')
  const expected_hashes = Object.fromEntries(Object.entries(runtime_hashes).filter(([name]) => batch_ids.includes(name.split('/')[0])))
  assert.deepEqual(result.runtime_hashes, expected_hashes, '分批资源与当前资源不一致')
  const control_keys = batch_ids.flatMap(id => modes.flatMap(mode => views.map(view => [id, mode, view].join('/'))))
  assert.deepEqual(result.controls.map(item => [item.id, item.mode, item.view].join('/')).sort(), control_keys.sort(), '控件对比度检查不完整')
  for (const control of result.controls) {
    assert.ok(control.metrics.length > 0, '控件对比度记录不能为空')
    for (const metric of control.metrics) {
      assert.ok(metric.text >= 4.5, '控件文字对比度不足')
      if (metric.boundary_required) assert.ok(metric.boundary >= 3, '控件边界对比度不足')
    }
  }
  const interaction_keys = batch_ids.flatMap(id => modes.flatMap(mode => ['settings', 'components'].map(view => [id, mode, view].join('/'))))
  assert.deepEqual(result.interactions.map(item => [item.id, item.mode, item.view].join('/')).sort(), interaction_keys.sort(), '交互检查不完整')
  for (const interaction of result.interactions) {
    const checks = interaction.view === 'settings' ? ['changed'] : ['closed', 'opened', 'focused', 'returned', 'moved', 'menu_closed']
    for (const check of checks) assert.equal(interaction[check], true, '交互检查失败')
  }
  for (const state of result.states) {
    assert.equal(state.overflow, false, '页面存在溢出')
    assert.equal(state.main_overflow, false, '主区域存在溢出')
    assert.equal(sha(await fs.readFile(path.join(directory, state.screenshot))), state.sha256, '截图内容与记录不一致')
  }
  assert.deepEqual(result.without_art.map(item => `${item.id}/${item.mode}`).sort(), batch_ids.flatMap(id => modes.map(mode => `${id}/${mode}`)).sort(), '无主图对照截图必须完整且不重复')
  for (const item of result.without_art) assert.equal(sha(await fs.readFile(path.join(directory, item.screenshot))), item.sha256, '无主图对照截图哈希不一致')
}

async function run_batch(batch_ids, scale, batch_root) {
  await fs.mkdir(batch_root, { recursive: true })
  const log = fs_sync.createWriteStream(path.join(batch_root, `visual-${scale}.log`))
  try {
    await new Promise((resolve, reject) => {
      const environment = { ...process.env }
      delete environment.ELECTRON_RUN_AS_NODE
      const child = spawn(require('electron'), [path.join(__dirname, 'theme_ui_samples_visual.cjs'), `--ids=${batch_ids.join(',')}`, `--scale=${scale}`, `--output=${batch_root}`], { cwd: root, windowsHide: true, env: environment })
      child.stdout.on('data', data => { log.write(data); process.stdout.write(data) })
      child.stderr.on('data', data => { log.write(data); process.stderr.write(data) })
      child.on('error', reject)
      child.on('close', code => code === 0 ? resolve() : reject(new Error(`分批进程失败，退出码 ${code}，主题 ${batch_ids.join(',')}`)))
    })
  } finally { await new Promise(resolve => log.end(resolve)) }
}

async function run() {
  assert.equal(new Set(ids).size, ids.length, '主题参数不能重复')
  assert.ok(ids.length > 0 && ids.every(id => catalog_ids.includes(id)), '存在未知主题')
  assert.ok(scales.every(scale => ['1', '1.25', '1.5'].includes(scale)), '缩放参数无效')
  const store = path.join(root, 'node_modules/.pnpm')
  const { buildSync } = require(path.join(store, fs_sync.readdirSync(store).find(name => name.startsWith('esbuild@')), 'node_modules/esbuild'))
  const engine_hash = sha(buildSync({ entryPoints: [path.join(__dirname, 'theme_preview_electron_entry.ts')], bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text)
  const runtime_hashes = {}
  const engine_resource_hashes = {}
  for (const name of ['dream-skin.css', 'renderer-inject.js']) engine_resource_hashes[name] = sha(await fs.readFile(path.join(root, 'resources/theme-engine', name)))
  for (const id of ids) for (const name of ['theme.json', 'original.css', 'hero-light.webp', 'hero-dark.webp']) runtime_hashes[`${id}/${name}`] = sha(await fs.readFile(path.join(root, 'resources/skins', id, name)))
  for (const scale of scales) {
    const output = path.join(output_root, `visual-${scale}`)
    await fs.mkdir(output, { recursive: true })
    await write_json(path.join(output, 'result.json'), { passed: false, reason: '本轮分批检查尚未完整合并' })
    const combined = { passed: true, type: '隔离Electron模拟预览，非真实Codex', scale, engine_bundle_sha256: engine_hash, engine_resource_hashes, runtime_hashes, ids, states: [], without_art: [], controls: [], interactions: [], errors: [], batches: [] }
    for (let offset = 0; offset < ids.length; offset += 4) {
      const batch_ids = ids.slice(offset, offset + 4)
      const batch_number = Math.floor(offset / 4) + 1
      const batch_root = path.join(output_root, 'batches', `batch-${batch_number}`)
      const batch_directory = path.join(batch_root, `visual-${scale}`)
      let result
      if (resume) {
        try {
          result = await read_json(path.join(batch_directory, 'result.json'))
          await validate_result(result, batch_ids, scale, batch_directory, engine_hash, runtime_hashes, engine_resource_hashes)
        } catch { result = undefined }
      }
      if (!result) {
        console.log(`开始隔离验收：比例 ${scale}，批次 ${batch_number}/${Math.ceil(ids.length / 4)}，主题 ${batch_ids.join(',')}`)
        await run_batch(batch_ids, scale, batch_root)
        result = await read_json(path.join(batch_directory, 'result.json'))
        await validate_result(result, batch_ids, scale, batch_directory, engine_hash, runtime_hashes, engine_resource_hashes)
      }
      for (const state of result.states) await fs.copyFile(path.join(batch_directory, state.screenshot), path.join(output, state.screenshot))
      for (const id of batch_ids) for (const mode of modes) {
        const filename = `${id}-${mode}-without-art.jpg`
        await fs.copyFile(path.join(batch_directory, filename), path.join(output, filename))
      }
      for (const name of ['states', 'without_art', 'controls', 'interactions']) combined[name].push(...result[name])
      combined.batches.push({ ids: batch_ids, result: path.relative(output, path.join(batch_directory, 'result.json')) })
      console.log(`已完成隔离验收：比例 ${scale}，批次 ${batch_number}/${Math.ceil(ids.length / 4)}，累计 ${combined.states.length}/${ids.length * 24} 状态`)
    }
    for (const [name, hash] of Object.entries(runtime_hashes)) assert.equal(sha(await fs.readFile(path.join(root, 'resources/skins', name))), hash, '验收过程中资源发生变化')
    for (const [name, hash] of Object.entries(engine_resource_hashes)) assert.equal(sha(await fs.readFile(path.join(root, 'resources/theme-engine', name))), hash, '验收过程中引擎资源发生变化')
    await validate_result(combined, ids, scale, output, engine_hash, runtime_hashes, engine_resource_hashes)
    const signatures = ids.map(id => {
      const state = combined.states.find(item => item.id === id && item.mode === 'dark' && item.view === 'home' && item.width === 1280)
      return [state.sidebar, state.titlebar, state.radius, state.selected].join('|')
    })
    assert.equal(new Set(signatures).size, ids.length, '跨批次组件样式必须保持差异')
    await write_json(path.join(output, 'result.json'), combined)
    console.log(`完整比例通过：${scale}，${combined.states.length} 状态，${combined.interactions.length} 交互，${output}`)
  }
}
run().catch(error => { console.error('完整主题验收失败：', error); process.exitCode = 1 })

import fs from 'fs'
import path from 'path'

/** 读取 backend/.env，不覆盖已经存在的环境变量（容器注入优先）。 */
const file = path.join(process.cwd(), '.env')
if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 0) continue
    const k = t.slice(0, i).trim()
    let v = t.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[k] == null) process.env[k] = v
  }
}

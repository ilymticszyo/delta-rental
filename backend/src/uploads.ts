import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { config } from './config'
import { ApiError } from './errors'

export interface StoredUpload {
  id: string
  url: string
  name: string
  mime: string
  relPath: string
  bytes: number
  uploadedBy: string
  createdAt: Date
}

const MIME_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

function sniff(buf: Buffer, mime: string) {
  if (mime === 'image/png') return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  if (mime === 'image/jpeg') return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8
  if (mime === 'image/gif') return buf.length > 6 && buf.subarray(0, 3).toString() === 'GIF'
  if (mime === 'image/webp') return buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP'
  return false
}

export function safeUploadPath(relPath: string) {
  const root = path.resolve(config.uploadDir)
  const full = path.resolve(root, relPath)
  if (full !== root && !full.startsWith(root + path.sep)) throw new ApiError('截图不存在', 404)
  return full
}

export async function writeImageBuffer(buf: Buffer, mimeRaw: string, name: string, uploadedBy: string): Promise<StoredUpload> {
  const mime = mimeRaw.toLowerCase() === 'image/jpg' ? 'image/jpeg' : mimeRaw.toLowerCase()
  const ext = MIME_EXT[mime]
  if (!ext) throw new ApiError('截图仅支持 png / jpeg / webp / gif')
  if (!buf.length) throw new ApiError('截图内容为空')
  if (buf.length > 1024 * 1024) throw new ApiError('单张截图不能超过 1MB')
  if (!sniff(buf, mime)) throw new ApiError('截图内容与格式不符')
  const id = crypto.randomBytes(16).toString('hex')
  const relPath = id + ext
  await fs.promises.mkdir(config.uploadDir, { recursive: true })
  await fs.promises.writeFile(safeUploadPath(relPath), buf)
  return { id, url: `/api/uploads/${id}`, name: (name || 'image').slice(0, 200), mime, relPath, bytes: buf.length, uploadedBy, createdAt: new Date() }
}

export function parseDataUrl(dataUrl: string) {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) throw new ApiError('截图格式无效')
  const header = dataUrl.slice(0, comma)
  const m = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64$/i.exec(header.replace(/\s/g, ''))
  if (!m) throw new ApiError('截图仅支持 png / jpeg / webp / gif')
  const buf = Buffer.from(dataUrl.slice(comma + 1).replace(/\s/g, ''), 'base64')
  return { mime: m[1], buf }
}

/** 一次业务事务里新落下的文件，提交时写入 uploads 表。事务失败时文件可能残留在磁盘上。 */
export class DiskAttachmentStore {
  pending: StoredUpload[] = []
  async saveDataUrl(dataUrl: string, name: string, uploadedBy: string) {
    if (dataUrl.length > 1_400_000) throw new ApiError('单张截图不能超过 1MB')
    const { mime, buf } = parseDataUrl(dataUrl)
    const saved = await writeImageBuffer(buf, mime, name, uploadedBy)
    this.pending.push(saved)
    return saved
  }
  async saveBuffer(buf: Buffer, mime: string, name: string, uploadedBy: string) {
    const saved = await writeImageBuffer(buf, mime, name, uploadedBy)
    this.pending.push(saved)
    return saved
  }
}

export async function removeUploadFiles() {
  await fs.promises.mkdir(config.uploadDir, { recursive: true })
  const names = await fs.promises.readdir(config.uploadDir)
  await Promise.all(names.map((n) => fs.promises.rm(path.join(config.uploadDir, n), { force: true })))
}

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
}

function sniff(buf: Buffer, mime: string) {
  if (mime === 'image/png') return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  if (mime === 'image/jpeg') return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8
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
  if (!ext) throw new ApiError('截图仅支持 png / jpeg / webp', 415, false, 'UNSUPPORTED_MEDIA_TYPE')
  if (!buf.length) throw new ApiError('截图内容为空')
  if (buf.length > 1024 * 1024) throw new ApiError('单张截图不能超过 1MB', 413, false, 'PAYLOAD_TOO_LARGE')
  if (!sniff(buf, mime)) throw new ApiError('截图内容与格式不符', 415, false, 'UNSUPPORTED_MEDIA_TYPE')
  const cleaned = mime === 'image/jpeg' ? stripJpegExif(buf) : mime === 'image/png' ? stripPngExif(buf) : buf
  const id = crypto.randomBytes(16).toString('hex')
  const relPath = id + ext
  await fs.promises.mkdir(config.uploadDir, { recursive: true })
  await fs.promises.writeFile(safeUploadPath(relPath), cleaned)
  return { id, url: `/api/uploads/${id}`, name: (name || 'image').slice(0, 200), mime, relPath, bytes: cleaned.length, uploadedBy, createdAt: new Date() }
}

function stripJpegExif(buf: Buffer): Buffer {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return buf
  const parts: Buffer[] = [buf.subarray(0, 2)]
  let i = 2
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) { parts.push(buf.subarray(i)); break }
    const marker = buf[i + 1]
    if (marker === 0xda) { parts.push(buf.subarray(i)); break }
    if (marker === 0xd9) { parts.push(buf.subarray(i, i + 2)); break }
    const len = buf.readUInt16BE(i + 2)
    const end = i + 2 + len
    if (end > buf.length) break
    const isApp = marker >= 0xe1 && marker <= 0xef
    if (!isApp) parts.push(buf.subarray(i, end))
    i = end
  }
  return Buffer.concat(parts)
}

function stripPngExif(buf: Buffer): Buffer {
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return buf
  const parts: Buffer[] = [buf.subarray(0, 8)]
  let i = 8
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i)
    const type = buf.subarray(i + 4, i + 8).toString('ascii')
    const end = i + 12 + len
    if (end > buf.length) break
    if (type !== 'eXIf') parts.push(buf.subarray(i, end))
    i = end
    if (type === 'IEND') break
  }
  return Buffer.concat(parts)
}

export function parseDataUrl(dataUrl: string) {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) throw new ApiError('截图格式无效')
  const header = dataUrl.slice(0, comma)
  const m = /^data:(image\/(?:png|jpeg|jpg|webp));base64$/i.exec(header.replace(/\s/g, ''))
  if (!m) throw new ApiError('截图仅支持 png / jpeg / webp', 415, false, 'UNSUPPORTED_MEDIA_TYPE')
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

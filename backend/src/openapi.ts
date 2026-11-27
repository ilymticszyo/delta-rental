import fs from 'fs'
import path from 'path'

/** 权威契约是仓库 docs/openapi.yaml。这里只定位那份文件，避免再维护一份会过期的路径表。 */
export function openapiYamlPath(): string | undefined {
  const candidates = [
    process.env.OPENAPI_PATH,
    path.join(process.cwd(), 'openapi.yaml'),
    path.join(process.cwd(), '../docs/openapi.yaml'),
    path.join(__dirname, '../openapi.yaml'),
    path.join(__dirname, '../../docs/openapi.yaml'),
  ].filter((p): p is string => !!p)
  return candidates.find((p) => fs.existsSync(p))
}

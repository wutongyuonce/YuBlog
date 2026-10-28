/**
 * 屏幕时间快照的远端存放处：本机脚本写入，`api/screen-time.js` 读取。
 *
 * 只负责 Blob 地址与上下行的编解码；快照形状由 `./screen-time.js` 校验，
 * 响应的缓存策略与状态码属于 `api/screen-time.js`。
 */

/** 固定路径覆盖写入同一个对象，每次同步不会产生新的 key。 */
const SCREEN_TIME_PATHNAME = 'screen-time.json'

/** Blob 自身缓存的最短值是一分钟；接口另有更长的边缘缓存。 */
const BLOB_CACHE_SECONDS = 60

/**
 * 公开对象的地址由存储 ID 决定：`store_` 前缀可有可无，域名部分不带前缀且小写，
 * 与 Dashboard 中该存储的 Base URL 一致。这样读取时不必先做一次元数据查询——
 * 在 Hobby 额度里 `head()` 计入 Simple Operations，按接口缓存频率它会成为最大的开销。
 */
function screenTimeBlobUrl(storeId) {
  const id = typeof storeId === 'string' ? storeId.trim() : ''
  if (!/^(store_)?[A-Za-z0-9]+$/.test(id))
    throw new Error('Screen time: invalid BLOB_STORE_ID')
  return `https://${id.replace(/^store_/, '').toLowerCase()}.public.blob.vercel-storage.com/${SCREEN_TIME_PATHNAME}`
}

/** 取回未经校验的原始响应体；形状校验属于接口。 */
export async function readScreenTime({ storeId, fetchImpl = fetch } = {}) {
  const url = screenTimeBlobUrl(storeId)
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`Screen time: blob HTTP ${response.status}`)
  return await response.json()
}

/**
 * 覆盖写入当天之前七天的聚合结果，返回可公开读取的地址。
 *
 * `put` 延迟导入：接口只读，静态导入会把上传所需的依赖也拉进函数包。
 */
export async function writeScreenTime(snapshot, { token, client } = {}) {
  if (!token) throw new Error('Screen time: missing BLOB_READ_WRITE_TOKEN')
  const upload = client?.put ?? (await import('@vercel/blob')).put
  const { url } = await upload(
    SCREEN_TIME_PATHNAME,
    `${JSON.stringify(snapshot, null, 2)}\n`,
    {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
      cacheControlMaxAge: BLOB_CACHE_SECONDS,
      token,
    }
  )
  return url
}

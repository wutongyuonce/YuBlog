/**
 * 听歌接口共用的响应语义：方法、查询参数、密钥缺失、上游失败的状态码与缓存头。
 * 以下划线开头，Vercel 不把它当作函数部署；各接口只决定取什么数据和缓存多久。
 */

const NO_STORE = 'no-store'

const json = (body, { status = 200, cache }) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cache,
    },
  })

/**
 * 错误响应一律不带缓存：失败的请求要能被下一次请求覆盖，也不能让带查询参数的地址
 * 绕开缓存、反复触发上游查询。
 *
 * @param {Request} request
 * @param {{ apiKey?: string, cache: string, load: () => Promise<unknown> }} options
 */
export async function respondWithLastfm(request, { apiKey, cache, load }) {
  if (request.method !== 'GET')
    return new Response(null, {
      status: 405,
      headers: { 'allow': 'GET', 'cache-control': NO_STORE },
    })
  if (new URL(request.url).search)
    return json({ error: 'unexpected_query' }, { status: 400, cache: NO_STORE })
  if (typeof apiKey !== 'string' || !apiKey.trim())
    return json({ error: 'missing_api_key' }, { status: 503, cache: NO_STORE })
  try {
    return json(await load(), { cache })
  } catch (error) {
    // 适配器保证消息里没有密钥和上游原文，可以安全写入运行日志。
    console.error(error.message)
    return json(
      { error: 'upstream_unavailable' },
      { status: 502, cache: NO_STORE }
    )
  }
}

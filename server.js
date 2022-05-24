const DEFAULT_CACHE_TIME = 60 * 60 // 60 minutes
const MIN_CACHE_TIME = 5 * 60 // 5 minutes

async function processRequest(req, res) {
  const startTime = new Date()
  const params = parseParams(req)

  if (params.requestMethod === 'OPTIONS') {
    return res.end()
  }

  const page = await getPage(params)

  return createResponse(page, params, startTime)
}
function parseParams(req) {
    const url = new URL(req.url);

  const params = {
    requestMethod: req.method,
    format: url.pathname.slice(1),
    url: url.searchParams.get('url'),
  }
  params.requestMethod = parseRequestMethod(params.requestMethod)
  params.format = (params.format || 'json').toLowerCase()
  return params
}
function parseRequestMethod(method) {
  method = (method || '').toUpperCase()

  if (['HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'].includes(method)) {
    return method
  }
  return 'GET'
}

async function createResponse(page, params, startTime) {
    const res = new Response()
    
  if (['GET', 'HEAD'].includes(params.requestMethod)) {
    const maxAge = params.disableCache
      ? 0
      : Math.max(
          MIN_CACHE_TIME,
          Number(params.cacheMaxAge) || DEFAULT_CACHE_TIME
        )

    res.headers.set('Cache-control', `public, max-age=${maxAge}, stale-if-error=600`)
  }
  if (params.format === 'raw' && !(page.status || {}).error) {
    res.headers.set(
      'Content-Length', page.contentLength
    )
    return new Response(page.content, res)
  }

  res.headers.set(
    'Content-Type',
    `application/json; charset=${params.charset || 'utf-8'}`
  )

  if (page.status) {
    page.status.response_time = new Date() - startTime
  } else {
    page.response_time = new Date() - startTime
  }

  if (params.callback) {
    return res.jsonp(page)
  }
  return new Response(new TextEncoder().encode(JSON.stringify(page)), res)
}

addEventListener('fetch', event => {
  return event.respondWith(processRequest(event.request));
})

function getPage({ url, format, requestMethod, charset }) {
  if (format === 'info' || requestMethod === 'HEAD') {
    return getPageInfo(url)
  } else if (format === 'raw') {
    return getRawPage(url, requestMethod, charset)
  }

  return getPageContents(url, requestMethod, charset)
}

async function getPageInfo(url) {
  const { response, error } = await request(url, 'HEAD')
  if (error) return processError(error)

  return {
    url: url,
    // content_type: response.headers['content-type'],
    content_length: +response.headers['content-length'] || -1,
    http_code: response.statusCode,
  }
}

async function getRawPage(url, requestMethod, charset) {
  const { content, response, error } = await request(
    url,
    requestMethod,
    true,
    charset
  )

  if (error) return processError(error)

  const contentLength = new TextEncoder().encode(content.toString()).length;
  return {
    content,
    // contentType: response.headers['content-type'],
    contentLength,
  }
}

async function getPageContents(url, requestMethod, charset) {
  const { content, response, error } = await request(
    url,
    requestMethod,
    false,
    charset
  )
  if (error) return processError(error)

  const contentLength = new TextEncoder().encode(content.toString()).length;
  return {
    contents: content.toString(),
    status: {
      url: url,
      content_type: response.headers['content-type'],
      content_length: contentLength,
      http_code: response.statusCode,
    },
  }
}

async function request(url, requestMethod, raw = false, charset = null) {
  try {
    const options = {
      method: requestMethod,
      decompress: !raw,
    }
    const response = await fetch(url, options)
    if (options.method === 'HEAD') return { response }

    return processContent(response, charset)
  } catch (error) {
    return { error }
  }
}

async function processContent(response, charset) {
  const res = { response: response, content: response.body }
  if (charset && iconv.encodingExists(charset)) {
    res.content = iconv.decode(res.content, charset)
  }
  return res
}

async function processError(e) {
  const { response } = e
  if (!response) return { contents: null, status: { error: e } }

  const { url, statusCode: http_code, headers, body } = response
  const contentLength = new TextEncoder().encode(body).length;

  return {
    contents: body.toString(),
    status: {
      url,
      http_code,
    //   content_type: headers['content-type'],
      content_length: contentLength,
    },
  }
}

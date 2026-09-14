/**
 * Cloudflare Pages Function — 官网下载区 GitHub 直链同域代理。
 *
 * 背景：网页直接 fetch 'https://api.github.com/.../releases'（匿名、无 token）
 * 会被 GitHub 按「每 IP 每小时 60 次」限流，限流时返回 403 → 网页整体回落到
 * releases 页面，无法直接触发下载。改走本站同域 /api/releases 后，由 Cloudflare
 * 出口 IP 请求 GitHub，规避最终访客 IP 的匿名限流。
 *
 * 实现：只请求一次 'releases?per_page=100'（按发布时间倒序，list[0] 即最新版），
 * 统一返回 { latest, list }。响应带 Cache-Control 让 Cloudflare 边缘缓存，
 * 显著降低对 GitHub 的命中频率，进一步缓解 CF 出口 IP 的限流压力。
 *
 * 路由：GET /api/releases
 */
const REPO = 'wf-Peg/ai_coding';
const GITHUB_API = `https://api.github.com/repos/${REPO}`;
const REQUEST_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'cutshelter-site',
};

export async function onRequest(context) {
  try {
    // 若配置了 GITHUB_TOKEN（CF Pages 环境变量），走认证 API（5000 次/小时，
    // 不受匿名 60 次/小时限流），可实时取最新版；未配置则回退匿名请求。
    const headers = { ...REQUEST_HEADERS };
    if (context.env && context.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${context.env.GITHUB_TOKEN}`;
    }
    const res = await fetch(`${GITHUB_API}/releases?per_page=100`, { headers });
    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: `github ${res.status}` }),
        { status: 502, headers: jsonHeaders() }
      );
    }

    const list = await res.json();
    const latest = Array.isArray(list) && list.length ? list[0] : null;

    return new Response(JSON.stringify({ latest, list }), {
      headers: jsonHeaders({ 'Cache-Control': 'public, s-maxage=600, max-age=600' }),
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502,
      headers: jsonHeaders(),
    });
  }
}

function jsonHeaders(extra) {
  const base = { 'Content-Type': 'application/json; charset=utf-8' };
  return Object.assign(base, extra || {});
}
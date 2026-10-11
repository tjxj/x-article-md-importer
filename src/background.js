const IMAGE_HOSTS = new Set(['r2blog.zhanglearning.com', 'r2.zhanglearning.com']);

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'xmd:fetch-image') return;
  (async () => {
    if (!sender.url?.startsWith('https://x.com/')) throw new Error('只允许 X 页面读取文章图片');
    const url = new URL(message.url);
    if (url.protocol !== 'https:' || !IMAGE_HOSTS.has(url.hostname)) throw new Error('此图片域名未获授权，请先把图片转存到老章 R2 图床，或选择本地图片文件');
    const response = await fetch(url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`图片下载失败：HTTP ${response.status}`);
    const type = response.headers.get('content-type')?.split(';')[0] || '';
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type)) throw new Error(`不支持的图片类型：${type}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 20 * 1024 * 1024) throw new Error('单张图片超过 20 MB');
    let binary = '';
    for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
    return { ok: true, base64: btoa(binary), type, filename: decodeURIComponent(url.pathname.split('/').pop()) || 'image.png' };
  })().then(respond, error => respond({ ok: false, error: error.message }));
  return true;
});

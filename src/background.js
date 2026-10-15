const IMAGE_HOSTS = new Set(['r2blog.zhanglearning.com', 'r2.zhanglearning.com']);

function imageType(bytes, header) {
  const normalized = header.split(';')[0].trim().toLowerCase();
  if (normalized === 'image/jpg') return 'image/jpeg';
  if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(normalized)) return normalized;
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return '';
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'xmd:ping') {
    respond({ ok: true, version: chrome.runtime.getManifest().version });
    return;
  }
  if (message?.type !== 'xmd:fetch-image') return;
  (async () => {
    if (!sender.url?.startsWith('https://x.com/')) throw new Error('只允许 X 页面读取文章图片');
    const url = new URL(message.url);
    if (url.protocol !== 'https:' || !IMAGE_HOSTS.has(url.hostname)) throw new Error('此图片域名未获授权，请先把图片转存到老章 R2 图床，或选择本地图片文件');
    const response = await fetch(url, { credentials: 'omit', redirect: 'follow', signal: AbortSignal.timeout(30000) });
    if (!IMAGE_HOSTS.has(new URL(response.url).hostname)) throw new Error('图片跳转到了未授权域名');
    if (!response.ok) throw new Error(`图片下载失败：HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const type = imageType(bytes, response.headers.get('content-type') || '');
    if (!type) throw new Error(`不支持的图片类型：${response.headers.get('content-type') || '未知'}`);
    if (bytes.length > 20 * 1024 * 1024) throw new Error('单张图片超过 20 MB');
    let binary = '';
    for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
    return { ok: true, base64: btoa(binary), type, filename: decodeURIComponent(url.pathname.split('/').pop()) || 'image.png' };
  })().then(respond, error => respond({ ok: false, error: error.message }));
  return true;
});

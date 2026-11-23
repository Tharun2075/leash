// Byte-range support for the self-hosted demo video: Cloudflare Pages answers a Range request
// with 200 + the whole file, and iOS Safari needs 206 to play a <video>.
// Only /assets/*.mp4 reaches this worker (see _routes.json); every other path is plain static.
export default {
  async fetch(request, env) {
    const res = await env.ASSETS.fetch(new Request(request.url, { method: request.method }));
    const headers = new Headers(res.headers);
    headers.set("Accept-Ranges", "bytes");
    const range = request.headers.get("Range");
    const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m || (m[1] === "" && m[2] === "") || res.status !== 200 || request.method !== "GET") {
      return new Response(res.body, { status: res.status, headers });
    }
    const buf = await res.arrayBuffer();
    const size = buf.byteLength;
    let start, end;
    if (m[1] === "") { start = Math.max(0, size - Number(m[2])); end = size - 1; }
    else { start = Number(m[1]); end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1); }
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    return new Response(buf.slice(start, end + 1), { status: 206, headers });
  },
};

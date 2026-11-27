# 安全响应头（被 deploy/nginx.conf include）。注意：nginx 的 add_header 在 location 里一旦出现就不再继承 server 级的 add_header，
# 所以每个自己加了头的 location 都 include 这个文件。
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
# Element Plus 运行时会写内联 style，所以 style-src 需要 'unsafe-inline'；脚本只允许同源。
# 截图若放在 OSS 等其他域名，把该域名加到 img-src（例如 https://xxx.oss-cn-hangzhou.aliyuncs.com）。
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ${CSP_IMG_EXTRA}; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;

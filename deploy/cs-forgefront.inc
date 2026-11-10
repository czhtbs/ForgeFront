location = /forgefront/ { return 308 /forgefront; }
location = /forgefront/play { return 308 /forgefront/play/; }
location @cs_forgefront_login { return 302 /forgefront; }

location = /forgefront/play/socket {
    auth_request /_station_openfront_auth;
    auth_request_set $cs_ff_id $upstream_http_x_cs_player_id;
    auth_request_set $cs_ff_access $upstream_http_x_cs_set_access;
    auth_request_set $cs_ff_refresh $upstream_http_x_cs_set_refresh;
    add_header Set-Cookie $cs_ff_access always;
    add_header Set-Cookie $cs_ff_refresh always;
    proxy_pass http://unix:/run/cs-forgefront/game.sock;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header Origin $http_origin;
    proxy_set_header X-CS-Player-ID $cs_ff_id;
    proxy_set_header Cookie "";
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header CF-Connecting-IP "";
    proxy_set_header True-Client-IP "";
    proxy_read_timeout 90s;
    proxy_buffering off;
}

location /forgefront/play/ {
    auth_request /_station_openfront_auth;
    auth_request_set $cs_ff_access $upstream_http_x_cs_set_access;
    auth_request_set $cs_ff_refresh $upstream_http_x_cs_set_refresh;
    add_header Set-Cookie $cs_ff_access always;
    add_header Set-Cookie $cs_ff_refresh always;
    error_page 401 = @cs_forgefront_login;
    alias /usr/local/lib/cs-forgefront/current/dist/;
    index index.html;
    try_files $uri $uri/ /forgefront/play/index.html;
    gzip_static on;
    add_header Cache-Control "private, no-cache";
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'self'; object-src 'none'; base-uri 'self'" always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy same-origin always;
    add_header X-Frame-Options SAMEORIGIN always;
}

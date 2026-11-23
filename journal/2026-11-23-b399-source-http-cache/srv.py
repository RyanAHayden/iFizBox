import http.server, sys, time
t0=time.time(); mode=sys.argv[2]
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(s):
        # "change": every answer a new body; "same": one body, 304 on a matching ETag
        n = str(time.time()) if mode=="change" else "same"
        et='"%s"'%n
        if s.headers.get("If-None-Match")==et:
            s.send_response(304); s.send_header("ETag",et); s.send_header("Cache-Control","max-age=600"); s.end_headers(); sys.stderr.write("SENT 304\n"); return
        b=("body "+n).encode(); s.send_response(200); s.send_header("Content-Type","application/json"); s.send_header("ETag",et)
        s.send_header("Cache-Control","max-age=600"); s.send_header("Content-Length",str(len(b))); s.end_headers(); s.wfile.write(b); sys.stderr.write("SENT 200\n")
    def log_message(s,*a): pass
http.server.HTTPServer(("127.0.0.1",int(sys.argv[1])),H).serve_forever()

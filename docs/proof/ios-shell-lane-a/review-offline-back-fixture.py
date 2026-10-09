import http.server, threading, time, pathlib
ROOT = pathlib.Path(__file__).parent
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/stop':
            self.send_response(204)
            self.end_headers()
            def stop():
                time.sleep(.2)
                self.server.shutdown()
            threading.Thread(target=stop, daemon=True).start()
            return
        if self.path == '/back.js':
            body = (ROOT / 'back.js').read_bytes()
            mime = 'text/javascript'
        else:
            body = b'''<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Review fixture</title><h1>Healthy review document</h1><button id="panel">Open panel</button><dialog id="sheet">Review panel</dialog><button id="fail">Fail main frame</button><script src="/back.js"></script><script>NativeBack.activateNativeBackGesture();panel.onclick=()=>sheet.showModal();addEventListener('keydown',e=>{if(e.key==='Escape'&&sheet.open){e.preventDefault();sheet.close();}});fail.onclick=async()=>{await fetch('/stop');setTimeout(()=>location.href='/places?lane-retry=local#pubs',600);};try{Capacitor.Plugins.SplashScreen.hide();}catch(e){}</script>'''
            mime = 'text/html'
        self.send_response(200)
        self.send_header('Content-Type',mime)
        self.send_header('Content-Length',str(len(body)))
        self.send_header('Cache-Control','max-age=3600')
        self.end_headers()
        self.wfile.write(body)
class Server(http.server.ThreadingHTTPServer):
    allow_reuse_address=True
while True:
    server=Server(('127.0.0.1',3490),Handler)
    print('FIXTURE_LISTENING',flush=True)
    server.serve_forever()
    server.server_close()
    print('FIXTURE_ORIGIN_STOPPED',flush=True)
    time.sleep(15)

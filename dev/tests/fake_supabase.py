"""Kleiner Nachbau der Supabase-Schnittstellen, die die App benutzt (nur für Tests).
Auth (signup/token/user/logout), REST (records upsert/select, rpc next_invoice_number), Storage (upload/download)."""
import json, sys, uuid, time, threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote

LOCK = threading.Lock()
USERS = {}      # email -> {id, password}
TOKENS = {}     # token -> user id
RECORDS = {}    # (uid, store, id) -> row
FILES = {}      # path -> bytes
COUNTERS = {}   # (uid, year) -> value
SEQ = [time.time()]

def now_iso():
    with LOCK:
        SEQ[0] = max(SEQ[0] + 0.001, time.time())
        t = SEQ[0]
    return time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(t)) + '.%06d+00:00' % int((t % 1) * 1e6)

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def cors(self):
        self.send_header('Access-Control-Allow-Origin', self.headers.get('Origin') or '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
        self.send_header('Access-Control-Expose-Headers', 'Content-Range')

    def send(self, code, body=None, ctype='application/json', extra=None):
        data = b'' if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
        self.send_response(code)
        self.cors()
        self.send_header('Content-Type', ctype)
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return self.rfile.read(n) if n else b''

    def user(self):
        a = self.headers.get('Authorization', '')
        return TOKENS.get(a.replace('Bearer ', ''))

    def session(self, u, email):
        tok = uuid.uuid4().hex
        TOKENS[tok] = u
        user = {'id': u, 'aud': 'authenticated', 'role': 'authenticated', 'email': email, 'app_metadata': {}, 'user_metadata': {}, 'created_at': '2026-11-22T00:00:00Z'}
        return {'access_token': tok, 'token_type': 'bearer', 'expires_in': 3600, 'expires_at': int(time.time()) + 3600, 'refresh_token': uuid.uuid4().hex, 'user': user}

    def do_OPTIONS(self):
        self.send(204)

    def do_GET(self):
        p = urlparse(self.path)
        if p.path == '/debug/dump':
            return self.send(200, {'records': list(RECORDS.values()), 'files': {k: len(v) for k, v in FILES.items()}, 'plain': [k for k, v in FILES.items() if v.startswith(b'%PDF')]})
        if p.path == '/auth/v1/user':
            u = self.user()
            if not u: return self.send(401, {'msg': 'not logged in'})
            email = next(e for e, v in USERS.items() if v['id'] == u)
            return self.send(200, self.session(u, email)['user'])
        if p.path == '/rest/v1/records':
            u = self.user()
            if not u: return self.send(401, {'message': 'JWT required'})
            q = parse_qs(p.query)
            rows = [r for (uid_, _, _), r in RECORDS.items() if uid_ == u]
            gt = q.get('updated_at', [None])[0]
            if gt and gt.startswith('gt.'):
                rows = [r for r in rows if r['updated_at'] > gt[3:]]
            rows.sort(key=lambda r: r['updated_at'])
            rng = self.headers.get('Range')
            if rng:
                a, b = [int(x) for x in rng.split('-')]
                rows = rows[a:b + 1]
            sel = q.get('select', ['*'])[0].split(',')
            out = [{k: r[k] for k in sel} if sel != ['*'] else r for r in rows]
            return self.send(200, out)
        if p.path.startswith('/storage/v1/object/'):
            path = unquote(p.path[len('/storage/v1/object/'):])
            if path.startswith('authenticated/'): path = path[len('authenticated/'):]
            if path not in FILES: return self.send(400, {'statusCode': '404', 'error': 'not_found', 'message': 'Object not found'})
            return self.send(200, FILES[path], 'application/octet-stream')
        self.send(404, {'message': 'unbekannt ' + p.path})

    def do_POST(self):
        p = urlparse(self.path)
        raw = self.body()
        if p.path == '/auth/v1/signup':
            b = json.loads(raw)
            if b['email'] in USERS: return self.send(422, {'code': 422, 'error_code': 'user_already_exists', 'msg': 'User already registered'})
            u = str(uuid.uuid4())
            USERS[b['email']] = {'id': u, 'password': b['password']}
            return self.send(200, self.session(u, b['email']))
        if p.path == '/auth/v1/token':
            b = json.loads(raw)
            usr = USERS.get(b.get('email'))
            if not usr or usr['password'] != b.get('password'):
                return self.send(400, {'code': 400, 'error_code': 'invalid_credentials', 'msg': 'Invalid login credentials'})
            return self.send(200, self.session(usr['id'], b['email']))
        if p.path == '/auth/v1/logout':
            return self.send(204)
        u = self.user()
        if not u: return self.send(401, {'message': 'JWT required'})
        if p.path == '/rest/v1/records':
            rows = json.loads(raw)
            if isinstance(rows, dict): rows = [rows]
            for r in rows:
                if r.get('user_id') != u: return self.send(403, {'message': 'new row violates row-level security policy'})
                r = dict(r); r['updated_at'] = now_iso()
                RECORDS[(u, r['store'], r['id'])] = r
            return self.send(201)
        if p.path == '/rest/v1/rpc/next_invoice_number':
            b = json.loads(raw)
            k = (u, b['p_year'])
            with LOCK:
                COUNTERS[k] = max(COUNTERS.get(k, 0), max(b['p_floor'], 0)) + 1
                v = COUNTERS[k]
            return self.send(200, v)
        if p.path.startswith('/storage/v1/object/'):
            path = unquote(p.path[len('/storage/v1/object/'):])
            if not path.startswith('files/' + u + '/'): return self.send(403, {'message': 'new row violates row-level security policy'})
            ctype = self.headers.get('Content-Type', '')
            data = raw
            if ctype.startswith('multipart/form-data'):
                # Datei aus dem Formular holen
                boundary = ctype.split('boundary=')[1].encode()
                for part in raw.split(b'--' + boundary):
                    if b'\r\n\r\n' in part and b'filename' in part.split(b'\r\n\r\n')[0]:
                        data = part.split(b'\r\n\r\n', 1)[1].rsplit(b'\r\n', 1)[0]
            FILES[path] = data
            return self.send(200, {'Key': path, 'Id': str(uuid.uuid4())})
        self.send(404, {'message': 'unbekannt ' + p.path})

    do_PUT = do_POST

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 54321
    ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()

// Optional local preview. Opening index.html directly needs no runtime.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.md':'text/plain; charset=utf-8','.csv':'text/csv; charset=utf-8'};
const server = http.createServer((req,res) => {
  let name; try {name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);res.end();return;}
  const target=path.resolve(root,'.'+(name==='/'?'/index.html':name));
  if(!target.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  fs.readFile(target,(err,body)=>{if(err){res.writeHead(404);res.end('Not found');return;}res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body);});
});
server.listen(4173,'127.0.0.1',()=>console.log('Plecotus preview: http://127.0.0.1:4173'));

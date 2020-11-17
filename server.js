// TUBULAR-9000 Server - a small proxy for the Tubular-9000 client script to work around CORS limitations
// (c) 2020 Bertrand Le Roy

const http = require('http');
const https = require('https');
const fs = require('fs');

// Settings

const settings = {
  subscriptions: "subscriptions.opml",
  hostname: "127.0.0.1",
  port: 3000,
  staticExtensions: {
    html: "text/html",
    css: "text/css",
    js: "text/javascript",
    png: "image/png",
    ico: "image/vnd.microsoft.icon"
  },
  home: "tubular.html",
  allowedFeedHosts: ["www.youtube.com"]
};

// Server
const server = http.createServer((req, res) => {
  console.log(`${new Date().toTimeString()} Requested: ${req.url}`);
  try {
    if (req.method === "GET") {
      // Home page
      if (req.url === "/") {
        res.writeHead(200, {
          "Content-Type": "text/html"
        });
        fs.createReadStream(settings.home).pipe(res);
        return;
      }
      // Static files
      const extPos = req.url.lastIndexOf('.');
      if (extPos !== -1) {
        const ext = req.url.substr(extPos + 1);
        if (ext) {
          const mime = settings.staticExtensions[ext];
          if (mime) {
            const fileName = req.url.substr(1, extPos - 1);
            if (fileName && /^[\w\d\-]+$/.test(fileName)) {
              res.writeHead(200, {
                "Content-Type": mime
              });
              fs.createReadStream(`${fileName}.${ext}`).pipe(res);
              return;
            }
          }
        }
      }
      // Subscriptions
      if (req.url === "/subscriptions")
      {
        res.writeHead(200, {
          "Content-Type": "text/x-opml"
        });
        fs.createReadStream(settings.subscriptions).pipe(res);
        return;      
      }
      // Proxy
      if (req.url.substr(0, 6) === "/feed/") {
        const hostIndex = req.url.indexOf('/', 6);
        if (hostIndex !== -1) {
          const host = req.url.substr(6, hostIndex - 6);
          if (settings.allowedFeedHosts.indexOf(host) !== -1) {
            https.get(`https://${req.url.substr(6)}`, feed => {
              res.writeHead(feed.statusCode, {
                "Content-Type": "application/rss+xml"
              });
              feed.pipe(res);
            });
            return;
          }
        }
      }
    }
    // !found
    res.writeHead(404, {
      "Content-Type": "text/html"
    });
    res.end('<!DOCTYPE html><html lang="en"><head><title>404 !found</title></head><body><h1>404 !found</h1></body></html>');
  }
  catch(e) {
    // @#$%!
    console.log(`${new Date().toTimeString()} Error: ${e}`);
    res.writeHead(500, {
      "Content-Type": "text/html"
    });
    res.end('<!DOCTYPE html><html lang="en"><head><title>500 Shaman trance</title></head><body><h1>500 Shaman trance</h1></body></html>');
  }
});

server.listen(settings.port, settings.hostname, () => {
  console.log(`TUBULAR-9000 server running at http://${settings.hostname}:${settings.port}/`);
});
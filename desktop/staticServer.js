/*
 * Local static server for the Hidden Hunter desktop shell.
 *
 * Binds to 127.0.0.1 only and serves the frontend root. It does not start
 * Express, Socket.IO, or PostgreSQL, and it refuses paths outside that root.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const HOST = "127.0.0.1";

const ROOT_FILES = new Set([
  "index.html",
  "index.js",
  "style.css",
  "hidden-hunter.js",
  "hidden-hunter.css",
  "hidden-hunter-editor.js",
  "hidden-hunter-editor.css",
  "domino.js",
  "domino.css",
  "domino.html",
  "uno.js",
  "uno.css",
  "uno.html",
  "game-sfx.js"
]);

const BLOCKED_TOP = new Set([
  "server",
  "desktop",
  "node_modules",
  "tools",
  ".git",
  ".github"
]);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".zip": "application/zip"
};

function insideRoot(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel));
}

function requestedFile(root, urlPath) {
  let pathname = urlPath || "/";
  const query = pathname.indexOf("?");
  if (query !== -1) pathname = pathname.slice(0, query);
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (err) {
    return null;
  }
  if (decoded.indexOf("\0") !== -1) return null;
  decoded = decoded.replace(/\\/g, "/");
  if (decoded === "/" || decoded === "") return path.join(root, "index.html");
  if (!decoded.startsWith("/")) return null;
  const parts = decoded.split("/");
  if (parts[0] !== "") return null;
  const segments = parts.slice(1).filter((part) => part.length > 0);
  if (!segments.length) return path.join(root, "index.html");
  if (segments.some((part) => part === "." || part === "..")) return null;
  const top = segments[0].toLowerCase();
  if (BLOCKED_TOP.has(top)) return null;
  if (top !== "assets") {
    if (segments.length !== 1 || !ROOT_FILES.has(segments[0])) return null;
  }
  const resolved = path.resolve(root, ...segments);
  if (!insideRoot(root, resolved)) return null;
  return resolved;
}

function send(res, status, body, type) {
  const headers = {
    "Content-Type": type || "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff"
  };
  res.writeHead(status, headers);
  res.end(body);
}

function startStaticServer(options) {
  const root = fs.realpathSync(options && options.root ? options.root : path.resolve(__dirname, ".."));
  const server = http.createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      send(res, 405, "Method not allowed");
      return;
    }
    const filePath = requestedFile(root, req.url || "/");
    if (!filePath) {
      send(res, 404, "Not found");
      return;
    }
    fs.realpath(filePath, (realErr, realPath) => {
      if (realErr || !insideRoot(root, realPath)) {
        send(res, 404, "Not found");
        return;
      }
      fs.stat(realPath, (statErr, stat) => {
        if (statErr || !stat.isFile()) {
          send(res, 404, "Not found");
          return;
        }
        const type = TYPES[path.extname(realPath).toLowerCase()] || "application/octet-stream";
        res.writeHead(200, {
          "Content-Type": type,
          "Content-Length": stat.size,
          "Cache-Control": "no-cache",
          "X-Content-Type-Options": "nosniff"
        });
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        fs.createReadStream(realPath).pipe(res);
      });
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      resolve({
        host: HOST,
        port: address.port,
        close() {
          return new Promise((done) => server.close(() => done()));
        }
      });
    });
  });
}

module.exports = {
  startStaticServer,
  requestedFile,
  HOST
};

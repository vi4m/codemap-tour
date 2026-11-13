import { createServer } from "node:http";
createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<!doctype html><title>CodeMap Tour tests</title>");
}).listen(4319, "127.0.0.1");

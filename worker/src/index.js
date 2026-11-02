import http from "node:http";

const port = Number(process.env.PORT || 3000);
const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ service: "RIMURU TEMPEST MD", status: "healthy", whatsapp: "not-connected" }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(port, "0.0.0.0", () => console.log(`RIMURU TEMPEST MD worker listening on ${port}`));

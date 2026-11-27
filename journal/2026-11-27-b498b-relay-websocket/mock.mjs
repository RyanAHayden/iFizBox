// node mock.mjs: a WebSocket server that sends one 4 KB message and then leaves rudely: /end (FIN, no close frame),
// /reset (TCP RST), /close (close frame, then FIN at once).
import http from "node:http";
import { createHash } from "node:crypto";
const server = http.createServer();
server.on("upgrade", (req, socket) => {
  socket.on("error", () => {});
  const accept = createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  setTimeout(() => {
    const body = Buffer.from("x".repeat(4096));
    const frame = Buffer.concat([Buffer.from([0x81, 126, body.length >> 8, body.length & 255]), body]);
    if (req.url === "/close") socket.end(Buffer.concat([frame, Buffer.from([0x88, 2, 0x03, 0xe8])]));
    else if (req.url === "/end") socket.end(frame);
    else socket.write(frame, () => socket.resetAndDestroy());
  }, 100);
});
server.listen(28714, "127.0.0.1", () => console.log("mock on 28714"));
setTimeout(() => process.exit(0), 600000);

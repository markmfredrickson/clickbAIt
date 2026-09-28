/**
 * The byte pipe a mixer driver talks over. Drivers take one of these instead
 * of opening a socket, so tests can hand them an in-memory board.
 */

import { createSocket } from "node:dgram";

export interface OscTransport {
  send(buf: Buffer): void;
  onMessage(cb: (buf: Buffer) => void): void;
  close(): void;
}

/**
 * UDP to a board at `host:port` (the X32 listens on 10023).
 *
 * Sends and `/xremote` share one socket on purpose. The X32 reportedly does
 * not send a change back to the socket that made it, so on one socket every
 * change we receive came from someone else.
 */
export function udpTransport(host: string, port = 10023): OscTransport {
  const sock = createSocket("udp4");
  sock.on("error", (err) => console.error(`  ✗ mixer socket: ${err.message}`));
  return {
    send: (buf) =>
      sock.send(buf, port, host, (err) => {
        if (err) console.error(`  ✗ OSC → mixer failed: ${err.message}`);
      }),
    onMessage: (cb) => {
      sock.on("message", (msg) => cb(msg));
    },
    close: () => sock.close(),
  };
}

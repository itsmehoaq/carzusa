// All test processes inherit this guard. Accidental real HTTP or PostgreSQL connections fail immediately.
const net = require("node:net");
net.Socket.prototype.connect = function () {
  throw new Error("Network access is disabled in the offline test suite. Mock the transport.");
};
globalThis.fetch = async function () {
  throw new Error("Network access is disabled in the offline test suite. Mock fetch.");
};

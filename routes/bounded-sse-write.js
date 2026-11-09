function writeBoundedSse(client, chunk) {
  if (client.destroyed || client.writableEnded) return false;
  if (client.writableNeedDrain) {
    client.destroy();
    return false;
  }
  try {
    if (client.write(chunk)) return true;
  } catch {}
  client.destroy();
  return false;
}

module.exports = { writeBoundedSse };

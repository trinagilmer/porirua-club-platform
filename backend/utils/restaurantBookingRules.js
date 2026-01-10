function isCapacityError(err) {
  const msg = (err?.message || "").toLowerCase();
  return (
    err?.code === "MAX_ONLINE_PARTY_SIZE" ||
    msg.includes("capacity") ||
    msg.includes("allocation") ||
    err?.message === "No capacity remaining for this slot." ||
    err?.message === "Online allocation for this slot is full."
  );
}

function exceedsOnlinePartySize(service, size, channel) {
  if ((channel || "internal") !== "online") return false;
  const maxParty = parseInt(service?.max_online_party_size, 10);
  if (!Number.isInteger(maxParty) || maxParty <= 0) return false;
  return Number(size) > maxParty;
}

module.exports = {
  isCapacityError,
  exceedsOnlinePartySize,
};

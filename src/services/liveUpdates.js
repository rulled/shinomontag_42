let revision = 1;

function getLiveRevision() {
  return revision;
}

function bumpLiveRevision() {
  revision += 1;
  return revision;
}

module.exports = {
  getLiveRevision,
  bumpLiveRevision,
};


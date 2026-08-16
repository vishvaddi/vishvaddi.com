const baseUrl = (process.argv[2] || 'http://127.0.0.1:8787').replace(/\/$/, '');
const save = {
  saveVersion: 2,
  profileId: 'sync-smoke',
  revision: 1,
  updatedAt: Date.now(),
  career: { totalRuns: 0, gold: 0 },
};

function check(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`  ✓ ${message}`);
}

let authorization = '';
try {
  const createdResponse = await fetch(`${baseUrl}/api/deep-swarm/account`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ save }),
  });
  check(createdResponse.status === 201, `account creates — ${createdResponse.status}`);
  const created = await createdResponse.json();
  authorization = `Bearer ${created.accountId}.${created.secret}`;
  check(created.revision === 1 && created.accountId && created.secret, 'recovery credential is issued once');

  const readResponse = await fetch(`${baseUrl}/api/deep-swarm/save`, { headers: { Authorization: authorization } });
  const read = await readResponse.json();
  check(readResponse.ok && read.revision === 1 && read.save.profileId === save.profileId, 'authenticated save reads back');

  const updatedSave = { ...save, revision: 2, career: { totalRuns: 1, gold: 12 } };
  const updateResponse = await fetch(`${baseUrl}/api/deep-swarm/save`, {
    method: 'PUT',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision: 1, save: updatedSave }),
  });
  const updated = await updateResponse.json();
  check(updateResponse.ok && updated.revision === 2, 'optimistic save revision advances');

  const conflictResponse = await fetch(`${baseUrl}/api/deep-swarm/save`, {
    method: 'PUT',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision: 1, save }),
  });
  check(conflictResponse.status === 409, 'stale clients cannot overwrite newer progress');
} finally {
  if (authorization) {
    const deleted = await fetch(`${baseUrl}/api/deep-swarm/account`, { method: 'DELETE', headers: { Authorization: authorization } });
    check(deleted.status === 204, 'smoke account is deleted');
  }
}

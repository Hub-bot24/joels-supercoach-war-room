import fs from 'fs';

function chooseStatus(evidences) {
  const named = evidences.find(e => e.status === 'available' && e.confidence === 'high');

  const outEvidence = evidences.filter(e => e.status === 'out');
  const highOut = outEvidence.find(e => e.confidence === 'high');

  const independentOutKeys = new Set(
    outEvidence
      .filter(e => e.confidence === 'medium' || e.confidence === 'high')
      .map(e => e.url || e.source || e.reason)
  );

  const confirmedOut = highOut || (independentOutKeys.size >= 2 ? outEvidence[0] : null);

  if (confirmedOut) {
    return {
      status: 'out',
      label: confirmedOut.label || 'Out',
      sourceConfidence: confirmedOut.confidence || 'high',
      reason: confirmedOut.reason || 'Confirmed out/unavailable evidence.',
      sources: outEvidence.slice(0, 3),
      timeline: confirmedOut.timeline,
      returnWindow: confirmedOut.returnWindow,
      returnRound: confirmedOut.returnRound,
      returnWindowMinRound: confirmedOut.returnWindowMinRound,
      returnWindowMaxRound: confirmedOut.returnWindowMaxRound
    };
  }

  if (outEvidence.length) {
    const e = outEvidence[0];
    return {
      status: 'risk',
      label: 'Monitor',
      sourceConfidence: 'medium',
      reason: named
        ? 'Named in team list, but single injury source indicates possible issue; needs confirmation.'
        : 'Single injury source indicates possible out/unavailable; needs confirmation.',
      sources: named ? [named, e] : [e],
      timeline: e.timeline,
      returnWindow: e.returnWindow,
      returnRound: e.returnRound,
      returnWindowMinRound: e.returnWindowMinRound,
      returnWindowMaxRound: e.returnWindowMaxRound
    };
  }

  const risk = evidences.find(e => e.status === 'risk');
  if (risk) {
    return {
      status: 'risk',
      label: risk.label || 'Monitor',
      sourceConfidence: risk.confidence || 'medium',
      reason: risk.reason || 'Risk/monitor evidence.',
      sources: [risk],
      timeline: risk.timeline,
      returnWindow: risk.returnWindow,
      returnRound: risk.returnRound,
      returnWindowMinRound: risk.returnWindowMinRound,
      returnWindowMaxRound: risk.returnWindowMaxRound
    };
  }

  if (named) {
    return {
      status: 'available',
      label: 'Available',
      sourceConfidence: 'high',
      reason: named.reason,
      sources: [named]
    };
  }

  return null;
}

const now = new Date().toISOString();

let existing = {};
try {
  existing = JSON.parse(fs.readFileSync('player_status.json', 'utf8'));
} catch (err) {
  existing = {};
}

const output = {
  ...existing,
  updated: now,
  lastChecked: now
};

fs.writeFileSync('player_status.json', JSON.stringify(output, null, 2) + '\n');

fs.writeFileSync('status_update_report.json', JSON.stringify({
  updated: now,
  lastChecked: now,
  message: 'Status timestamp refreshed by scheduled workflow.'
}, null, 2) + '\n');

console.log(`player_status.json timestamp refreshed at ${now}`);

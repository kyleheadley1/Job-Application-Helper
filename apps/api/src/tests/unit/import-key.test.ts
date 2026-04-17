import { describe, expect, it } from 'vitest';
import { buildImportKey } from '../../tracker/importedJobFromSheet.js';

describe('buildImportKey', () => {
  it('is stable for equivalent content (spacing / case)', () => {
    const a = buildImportKey({
      fileFingerprint: 'fp1',
      company: 'Acme Corp',
      role: 'Software Engineer',
      jdInput: 'Build APIs',
      salaryAskRaw: '$150,000',
      latestScoreRaw: '72',
      originalAltScoreRaw: '',
    });
    const b = buildImportKey({
      fileFingerprint: 'fp1',
      company: '  acme corp ',
      role: 'software  engineer',
      jdInput: 'Build APIs',
      salaryAskRaw: '  $150,000 ',
      latestScoreRaw: '72',
      originalAltScoreRaw: '',
    });
    expect(a).toBe(b);
  });

  it('changes when JD or salary content changes', () => {
    const base = {
      fileFingerprint: 'fp',
      company: 'Co',
      role: 'Role',
      jdInput: 'Same JD',
      salaryAskRaw: '100k',
      latestScoreRaw: '50',
      originalAltScoreRaw: '',
    };
    const k1 = buildImportKey(base);
    const k2 = buildImportKey({ ...base, jdInput: 'Different JD' });
    const k3 = buildImportKey({ ...base, salaryAskRaw: '110k' });
    expect(k1).not.toBe(k2);
    expect(k1).not.toBe(k3);
  });

  it('changes when file fingerprint changes', () => {
    const base = {
      company: 'X',
      role: 'Y',
      jdInput: 'Z',
      salaryAskRaw: '',
      latestScoreRaw: '',
      originalAltScoreRaw: '',
    };
    expect(buildImportKey({ ...base, fileFingerprint: 'a' })).not.toBe(
      buildImportKey({ ...base, fileFingerprint: 'b' }),
    );
  });
});

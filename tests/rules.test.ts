import { describe, expect, it } from 'vitest';
import rulesFile from '../content-rules.public.json';
import { checkText, compileRules } from '../lib/lint';

/**
 * One sample each rule must reject and one it must accept. The rejected samples are deliberately
 * wrong statements: they exist only to prove that each rule fires. The accepted samples use the
 * wording CONTENT_RULES.md asks for, and none of them may trip any rule.
 */
const SAMPLES: Record<string, { fail: string; pass: string }> = {
  DASH: { fail: `Stage 1${String.fromCharCode(0x2014)}in progress`, pass: 'Stage 1, in progress' },
  'IP-CLAIM': { fail: 'a patented charger design', pass: 'a charger design' },
  'GPA-OLD': { fail: 'GPA: 3.8', pass: 'Major GPA 3.65' },
  'AVAIL-OLD': { fail: 'Open to Summer 2027 internships', pass: 'Available: Full-time, June 2027' },
  'PACK-600V': { fail: 'a 600 V pack', pass: '504 V max' },
  'THERM-144': { fail: 'a harness of 144 thermistors', pass: 'a harness of 140+ thermistors' },
  'PACK-540V': { fail: 'a 540 V pack', pass: 'the 540 V on-board charger' },
  'BMS-DESIGNED': { fail: 'I designed the BMS', pass: 'I programmed the Orion BMS 2' },
  'BR1-RAN': { fail: 'BR1 raced at competition', pass: 'The team completed the static events.' },
  'BR1-INSPECTION': { fail: 'The car passed technical inspection', pass: 'The team completed the static events.' },
  'BR2-LEAD': {
    fail: 'leading the battery redesign',
    pass: 'work with the team across the electrical and tractive-system stack',
  },
  'LEAD-2023': {
    fail: 'High-Voltage & Co-Electrical Lead, Sep 2023 to Jun 2026',
    pass: 'High-Voltage & Co-Electrical Lead on BR1, Nov 2025 to Jun 2026',
  },
  'PART-107': { fail: 'I hold an FAA Part 107 certificate', pass: 'FAA Part 107 is in progress.' },
  'RAVEN-FLOWN': { fail: 'Raven hovered in the lab', pass: 'Stage 1 of 8 is in progress.' },
  'RAVEN-SOFTWARE': { fail: 'I integrated ArduPilot on the testbed', pass: 'Autonomy software is a later roadmap stage.' },
  'RAVEN-THRUST': { fail: 'I measured the thrust of each motor', pass: 'No thrust figure exists yet.' },
  'MULTI-DRONE': { fail: 'a drone swarm', pass: 'coordinated multi-drone autonomy' },
  'BASE-AIRFRAME': { fail: 'the Stallion build', pass: 'the Flightory Stallion FPV airframe' },
  'RAVEN-ORIGIN': {
    fail: 'Raven, an original design',
    pass: 'Raven is a custom redesign on the Flightory Stallion FPV airframe.',
  },
  'RAVEN-SENIOR-DESIGN': { fail: 'Raven was my senior design project', pass: 'Raven is a personal project.' },
  'RAVEN-LIGHTING': { fail: 'a custom lighting PCB', pass: 'Stage 1 avionics selected and integrated' },
  'PLACEMENT-SWAP': { fail: '2nd place at the Asearis Hackathon', pass: '1st Place, Asearis Hackathon' },
  'PALMSYNC-ACCURACY': {
    fail: 'PalmSync reached 95% accuracy',
    pass: 'PalmSync validated sensor accuracy and signal stability',
  },
  HIL: { fail: 'a hardware-in-the-loop rig', pass: 'hardware-in-the-loop style bench tests' },
  'ST-PRODUCTION': {
    fail: 'production experience at STMicroelectronics',
    pass: 'engineering experience at STMicroelectronics',
  },
  'ST-CAN': { fail: 'CAN bus firmware during my STMicro internship', pass: 'CAN bus firmware for Bronco Racing' },
  'HONORS-LATIN': { fail: 'I graduated with Honors', pass: 'a member of the University Honors Program' },
  CAMBRIDGE: { fail: 'I studied at the University of Cambridge', pass: 'University of Cambridge A-Levels' },
  'EDA-TOOLS': { fail: 'schematics in Altium', pass: 'schematics in KiCad 9' },
  'TEST-METHODS': { fail: 'hipot testing on the pack', pass: 'bench validation with an oscilloscope' },
  RF: { fail: 'experience with RF design', pass: 'communication and RF' },
  'SENSOR-BOARDS': { fail: 'I built an IMU board', pass: 'I selected the Stage 1 avionics' },
  FUNDING: { fail: 'We raised a seed round', pass: 'a stealth AI hardware startup' },
  'GPA-LABEL': { fail: 'GPA 3.65', pass: 'Major GPA 3.65' },
  'DBVF-FLOWN': { fail: 'The hexacopter flew', pass: 'The hexacopter is in design.' },
  'FIRMWARE-CHECKS': { fail: '200 renderer checks', pass: 'firmware running on the lamp' },
  'DRONE-MAKER': { fail: 'a drone maker', pass: 'a stealth AI hardware startup' },
  'NAME-SPELLING': { fail: 'Amjad Rihawi', pass: 'Amjad Rehawi' },
  'DRIVE-LINK': { fail: 'https://drive.google.com/file/d/abc', pass: 'https://github.com/AmjadRx' },
  PLACEHOLDER: { fail: 'lorem ipsum', pass: 'Photo to come' },
};

const rules = compileRules(rulesFile);

describe('content-rules.public.json', () => {
  it('has 40 rules, each with a sample pair, and no sample for a rule that does not exist', () => {
    expect(rules).toHaveLength(40);
    expect(Object.keys(SAMPLES).sort()).toEqual(rules.map((r) => r.id).sort());
  });

  describe.each(rules.map((rule) => [rule.id, rule] as const))('%s', (id, rule) => {
    it('rejects its failing sample', () => {
      expect(rule.re.test(SAMPLES[id].fail)).toBe(true);
      expect(checkText(SAMPLES[id].fail, rules, []).map((hit) => hit.rule)).toContain(id);
    });

    it('accepts its passing sample', () => {
      expect(rule.re.test(SAMPLES[id].pass)).toBe(false);
    });
  });

  it('lets every passing sample through every rule', () => {
    for (const [id, sample] of Object.entries(SAMPLES)) {
      expect(checkText(sample.pass, rules, []), `${id} passing sample`).toEqual([]);
    }
  });
});

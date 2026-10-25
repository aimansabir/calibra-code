import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// studyVersion is the software release (package.json). protocolVersion is the
// study procedure in docs/experimental-plan.md: conditions, task allocation,
// adaptive rules, surveys and step order. Bump it only when one of those
// changes, so the analysis can tell apart data collected under different procedures.
const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));

export const STUDY_VERSION: string = pkg.version;
export const PROTOCOL_VERSION = '1.0';

export const versions = () => ({ studyVersion: STUDY_VERSION, protocolVersion: PROTOCOL_VERSION });

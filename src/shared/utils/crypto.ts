import { createHash, randomBytes } from 'node:crypto';

export const sha256 = (str: string): string => createHash('sha256').update(str).digest('hex');

export const generateTokenId = (): string => randomBytes(32).toString('hex');

import { Request } from 'express';
import { randomUUID } from 'crypto';

export function extractRealIp(req: Request): string {
  // Cloudflare / Nginx / Load balancer
  const forwarded = req.headers['x-forwarded-for'];

  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }

  // fallback to socket IP
  return req.socket?.remoteAddress || req.ip || '0.0.0.0';
}

export function extractUserAgent(req: Request): string | undefined {
  return req.get('user-agent') || undefined;
}

export function extractDeviceId(req: Request, dto: any): string {
  // Highest priority → body (mobile apps)
  if (dto?.deviceId) return String(dto.deviceId);

  // Header
  const headerId = req.headers['x-device-id'];
  if (typeof headerId === 'string' && headerId.trim() !== '') {
    return headerId.trim();
  }

  // Cookie (browser)
  const cookieId = req.cookies?.['x-device-id'];
  if (typeof cookieId === 'string' && cookieId.trim() !== '') {
    return cookieId.trim();
  }

  // Fallback → generate consistent ID
  return randomUUID();
}

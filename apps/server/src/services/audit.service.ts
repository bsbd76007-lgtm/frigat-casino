import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';

export type AdminAction =
  | 'BALANCE_ADJUSTED'
  | 'ROLE_CHANGED'
  | 'REVSHARE_CHANGED'
  | 'ACCOUNT_FROZEN'
  | 'ACCOUNT_UNFROZEN'
  | 'WITHDRAWAL_APPROVED'
  | 'WITHDRAWAL_REJECTED'
  | 'RISK_CONFIG_UPDATED';

export interface AuditParams {
  adminId: string;
  action: AdminAction;
  targetUserId?: string | null;
  details: Record<string, unknown>;
}

export class UnknownAdminError extends Error {
  constructor(adminId: string) {
    super(`admin ${adminId} is not a known user; refusing to act unaudited`);
    this.name = 'UnknownAdminError';
  }
}

export async function auditWithin(
  tx: Prisma.TransactionClient,
  params: AuditParams
) {
  return tx.adminAuditLog.create({
    data: {
      adminId: params.adminId,
      action: params.action,
      targetUserId: params.targetUserId ?? null,
      details: params.details as Prisma.InputJsonValue,
    },
    select: { id: true, createdAt: true },
  });
}

export async function writeAudit(params: AuditParams) {
  return prisma.$transaction((tx) => auditWithin(tx, params));
}

export function isUnknownAdminError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2003' &&
    String(error.meta?.field_name ?? '').includes('adminId')
  );
}

/** Queue names shared with the API (keep in sync with apps/api/src/common/mail/mail-queue.ts). */
export const QUEUES = {
  mailTransactional: 'mail-transactional',
  mailOutbound: 'mail-outbound', // phase 1: ticket replies
  mailInbound: 'mail-inbound', // phase 1: polling / Graph notifications
  attachmentScan: 'attachment-scan', // phase 1: ClamAV + sensitive data detector
  slaEscalation: 'sla-escalation', // phase 1
  retention: 'retention', // disabled until configured (ADR-0007 #9)
} as const;

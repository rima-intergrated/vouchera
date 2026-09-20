import AuditLog from '../models/AuditLog.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// GET /api/audit-logs — immutable audit trail, read-only.
// Permission 'audit.read' (ADMIN, AUDITOR). No write endpoints exist.
export const listAuditLogs = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.action) filter.action = req.query.action;
  if (req.query.entity) filter.entity = req.query.entity;
  if (req.query.actor) filter.actor = req.query.actor;
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(`${req.query.from}T00:00:00.000Z`);
    if (req.query.to) filter.createdAt.$lte = new Date(`${req.query.to}T23:59:59.999Z`);
  }
  const page = Math.max(1, parseInt(req.query.page ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? '20', 10) || 20));

  const [total, items] = await Promise.all([
    AuditLog.countDocuments(filter),
    AuditLog.find(filter)
      .populate('actor', 'name email role')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);
  res.json({
    items: items.map((a) => ({
      id: String(a._id),
      actor: a.actor ? { name: a.actor.name, email: a.actor.email, role: a.actor.role } : { name: null, email: a.actorEmail, role: a.actorRole },
      actorEmail: a.actorEmail,
      actorRole: a.actorRole,
      action: a.action,
      entity: a.entity,
      entityId: a.entityId,
      metadata: a.metadata,
      ip: a.ip,
      timestamp: a.createdAt,
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

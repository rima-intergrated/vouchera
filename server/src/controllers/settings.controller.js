import Setting, { KNOWN_SETTINGS } from '../models/Setting.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit } from '../utils/helpers.js';

export const listSettings = asyncHandler(async (req, res) => {
  const stored = await Setting.find().lean();
  const byKey = Object.fromEntries(stored.map((s) => [s.key, s]));
  // Always report the full known set (stored value or compiled default).
  const settings = Object.entries(KNOWN_SETTINGS).map(([key, def]) => ({
    key,
    value: byKey[key]?.value ?? def.default,
    description: def.description,
    default: def.default,
    updatedAt: byKey[key]?.updatedAt ?? null,
  }));
  res.json({ settings });
});

export const updateSetting = asyncHandler(async (req, res) => {
  const def = KNOWN_SETTINGS[req.params.key];
  if (!def) throw ApiError.notFound('Unknown setting');
  const { value } = req.body;

  if (def.type === 'integer') {
    if (!Number.isInteger(value) || value < def.min || value > def.max) {
      throw ApiError.badRequest(`Value must be a whole number between ${def.min} and ${def.max}`);
    }
  } else if (def.type === 'string') {
    if (typeof value !== 'string' || value.trim().length < def.min || value.length > def.max) {
      throw ApiError.badRequest(`Value must be ${def.min}–${def.max} characters`);
    }
  }

  const setting = await Setting.findOneAndUpdate(
    { key: req.params.key },
    { $set: { value, description: def.description, updatedBy: req.user._id } },
    { upsert: true, new: true }
  );
  audit({
    actor: req.user,
    action: 'settings.update',
    entity: 'Setting',
    entityId: req.params.key,
    metadata: { value },
    req,
  });
  res.json({ setting: { key: setting.key, value: setting.value, description: setting.description } });
});

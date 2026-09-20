import Store from '../models/Store.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { audit } from '../utils/helpers.js';

export const listStores = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.active === 'true') filter.isActive = true;
  const stores = await Store.find(filter).sort({ name: 1 });
  res.json({ stores });
});

export const updateStore = asyncHandler(async (req, res) => {
  const store = await Store.findById(req.params.id);
  if (!store) throw ApiError.notFound('Store not found');
  const { name, location, isActive } = req.body;
  const changed = [];
  if (name !== undefined && name.trim() !== store.name) {
    const clash = await Store.findOne({ name: name.trim(), _id: { $ne: store._id } });
    if (clash) throw ApiError.conflict('Store name already exists');
    store.name = name.trim();
    changed.push('name');
  }
  if (location !== undefined) { store.location = location; changed.push('location'); }
  if (isActive !== undefined && isActive !== store.isActive) { store.isActive = isActive; changed.push('isActive'); }
  await store.save();
  audit({ actor: req.user, action: 'store.update', entity: 'Store', entityId: String(store._id), metadata: { changed }, req });
  res.json({ store });
});

export const createStore = asyncHandler(async (req, res) => {
  const { name, code, location = '' } = req.body;
  const upper = String(code).toUpperCase().trim();
  const exists = await Store.findOne({ $or: [{ name }, { code: upper }] });
  if (exists) throw ApiError.conflict('Store name or code already exists');
  const store = await Store.create({ name: name.trim(), code: upper, location });
  audit({ actor: req.user, action: 'store.create', entity: 'Store', entityId: String(store._id), metadata: { name, code: upper }, req });
  res.status(201).json({ store });
});

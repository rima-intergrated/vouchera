import mongoose from 'mongoose';

const storeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    location: { type: String, default: '', trim: true },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

const Store = mongoose.model('Store', storeSchema);
export default Store;

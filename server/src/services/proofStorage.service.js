import mongoose from 'mongoose';

// Proof-of-payment storage on GridFS (same MongoDB as everything else), so
// files survive redeploys/restarts with no extra infrastructure, accounts or
// cost — unlike local disk, which is ephemeral on most hosts.
// Bucket: popProofs.{files,chunks}. Files are small (≤5MB) and low-volume,
// well within GridFS's comfort zone.
const BUCKET = 'popProofs';

function bucket() {
  const db = mongoose.connection?.db;
  if (!db) throw new Error('Database connection is not ready');
  return new mongoose.mongo.GridFSBucket(db, { bucketName: BUCKET });
}

// Persist a validated upload buffer. Returns the metadata recorded on the
// transaction/request document. The caller deletes via deleteProof() if the
// surrounding write fails, so failed requests never orphan chunks.
export async function saveProof({ buffer, originalName, mimetype }) {
  const clean = String(originalName || 'proof').replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'proof';
  const b = bucket();
  const stream = b.openUploadStream(`${Date.now()}-${clean}`, { contentType: mimetype });
  const done = new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
  stream.write(buffer);
  stream.end();
  await done;
  return { fileId: stream.id, filename: clean, mimetype, size: buffer.length };
}

// Stream a stored proof to an HTTP response. Returns false when missing.
export async function streamProof(fileId, mimetype, res) {
  let id = fileId;
  try {
    id = new mongoose.Types.ObjectId(String(fileId));
  } catch {
    return false;
  }
  try {
    const files = await bucket().find({ _id: id }).toArray();
    if (!files.length) return false;
    res.setHeader('Content-Type', mimetype || files[0].contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${files[0].filename}"`);
    await new Promise((resolve, reject) => {
      bucket()
        .openDownloadStream(id)
        .on('error', reject)
        .on('end', resolve)
        .pipe(res);
    });
    return true;
  } catch {
    return false;
  }
}

export async function deleteProof(fileId) {
  if (!fileId) return;
  try {
    await bucket().delete(new mongoose.Types.ObjectId(String(fileId)));
  } catch {
    // Already gone — nothing to do.
  }
}
